// Перенос данных из старой CRM (файл экспорта «crm-ГГГГ-ММ-ДД.json»).
// Чистый модуль без браузерных зависимостей: работает и в браузере, и в node-тестах.
// Доступ к серверу передаётся адаптером api (см. sdkApi).

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => String(v ?? '').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const uniq = (list) => [...new Set(list.map(str).filter(Boolean))];

// Имена, которые нужно сопоставить с сотрудниками: мастера заказов, штрафы, выплаты ЗП.
function oldNames(json) {
  return uniq([
    ...arr(json.orders).map((o) => o.master),
    ...arr(json.fines).map((f) => f.master),
    ...arr(json.cash).filter((c) => c.kind === 'salary').map((c) => c.who),
  ]);
}

// Разбор файла: сколько чего найдено, какие старые точки и имена надо сопоставить.
export function analyze(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.orders) || !Array.isArray(json.clients)) {
    throw new Error('Файл не похож на экспорт старой CRM: нет списка заказов и клиентов.');
  }
  const orders = arr(json.orders);
  return {
    counts: {
      clients: arr(json.clients).length,
      parts: arr(json.parts).length,
      orders: orders.length,
      orderParts: orders.reduce((s, o) => s + arr(o.parts).length, 0),
      payments: arr(json.payments).length,
      cash: arr(json.cash).length,
      fines: arr(json.fines).length,
      shifts: arr(json.shifts).length,
    },
    points: uniq([...orders.map((o) => o.point), ...arr(json.cash).map((c) => c.point)]),
    names: oldNames(json),
  };
}

// ---------- перенос ----------

const METHODS = ['Нал', 'Перевод', 'Терминал'];
const STATUSES = ['new', 'diag', 'wait', 'work', 'ready', 'issued', 'refuse'];
const KINDS = ['salary', 'expense', 'withdraw'];
const CHUNK = 10; // запросов одновременно
const PENDING = '…'; // ключ занят запросом, который ещё не вернулся
export const NET_STOP = 'Нет связи с сервером — перенос остановлен, можно запустить повторно, дублей не будет';
const isNetErr = (e) => !!e && (e.isNetwork || (e.status === 0 && !e.isAbort));

// Старая дата: «ГГГГ-ММ-ДД» → местный полдень (день не «съезжает» в любом поясе), ISO → как есть.
export function oldDate(v) {
  const s = str(v);
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : new Date(s);
  return isNaN(d) ? '' : d.toISOString();
}

// Текст ошибки сервера для отчёта (SDK: err.response.{message,data}).
function errText(e) {
  const r = e && e.response;
  const fields = r && r.data && typeof r.data === 'object'
    ? Object.entries(r.data).map(([k, v]) => `${k}: ${(v && v.message) || v}`).join('; ') : '';
  return [(r && r.message) || (e && e.message) || String(e), fields].filter(Boolean).join(' — ');
}

// Адаптер для SDK PocketBase (браузер и тесты). wrap — обёртка каждого запроса (например, store.request).
export function sdkApi(pb, wrap = (fn) => fn()) {
  return {
    list: (col, fields) => wrap(() => pb.collection(col).getFullList({ batch: 1000, fields, requestKey: null })),
    create: (col, data) => wrap(() => pb.collection(col).create(data, { requestKey: null })),
    update: (col, id, data) => wrap(() => pb.collection(col).update(id, data, { requestKey: null })),
  };
}

// Перенос. mapping = { points: {старое имя: id точки}, names: {старое имя: id сотрудника | ''} }.
// onProgress({stage, done, total}). api — {list(col, fields), create(col, data), update(col, id, data)}, см. sdkApi.
// Возвращает отчёт { created, skipped, errors: [{what, text}], notes }.
// Записи с уже перенесённым legacyId (для запчастей заказа — legacyKey) пропускаются.
export async function run(json, mapping, onProgress = () => {}, api) {
  const info = analyze(json);
  if (!api) throw new Error('Нет связи с сервером для переноса.');
  const pointMap = (mapping && mapping.points) || {};
  const nameMap = (mapping && mapping.names) || {};
  const missing = info.points.filter((p) => !pointMap[p]);
  if (missing.length) throw new Error('Укажите адрес для старых точек: ' + missing.join(', '));

  const pointOf = (v) => pointMap[str(v)] || '';
  const userOf = (v) => nameMap[str(v)] || '';
  const kinds = ['clients', 'parts', 'orders', 'orderParts', 'payments', 'cash', 'fines'];
  const report = {
    created: Object.fromEntries(kinds.map((k) => [k, 0])),
    skipped: Object.fromEntries(kinds.map((k) => [k, 0])),
    errors: [],
    notes: [],
  };
  if (info.counts.shifts) report.notes.push(`Смены не переносятся (раздел убран): ${info.counts.shifts} шт.`);

  const total = kinds.reduce((s, k) => s + info.counts[k], 0) + 1;
  let done = 0;
  const tick = (stage, n = 1) => { done += n; onProgress({ stage, done, total }); };

  // Уже перенесённое: legacyId → id новой записи.
  const existing = async (col, key = 'legacyId') => {
    const list = await api.list(col, `id,${key}`);
    return new Map(list.filter((r) => r[key]).map((r) => [r[key], r.id]));
  };

  // Общий проход: пропуск по ключу, создание пакетами, ошибки отдельных записей — в отчёт.
  // Ключ резервируется до запроса — две записи с одним старым id не создадут дубль.
  // Обрыв связи останавливает весь перенос (повторный запуск доберёт остальное без дублей).
  async function pass(kind, stage, col, items, { known, key, build, what, done: onDone, chunk: size = CHUNK }) {
    for (let i = 0; i < items.length; i += size) {
      const chunk = items.slice(i, i + size);
      await Promise.all(chunk.map(async (item) => {
        const k = key(item);
        if (k && known.has(k)) { report.skipped[kind]++; return; }
        if (k) known.set(k, PENDING);
        try {
          const rec = await api.create(col, build(item));
          if (k) known.set(k, rec.id);
          report.created[kind]++;
          if (onDone) onDone(item, rec);
        } catch (e) {
          if (k) known.delete(k);
          if (isNetErr(e)) throw new Error(NET_STOP);
          report.errors.push({ what: what(item), text: errText(e) });
        }
      }));
      tick(stage, chunk.length);
    }
    return known;
  }

  // --- клиенты ---
  const clients = await pass('clients', 'Клиенты', 'clients', arr(json.clients), {
    known: await existing('clients'),
    key: (c) => str(c.id),
    what: (c) => `Клиент «${str(c.name)}»`,
    build: (c) => ({ name: str(c.name), phone: str(c.phone), source: str(c.source), note: str(c.note), legacyId: str(c.id) }),
  });

  // --- запчасти (остаток — как в старой версии) ---
  const parts = await pass('parts', 'Запчасти', 'parts', arr(json.parts), {
    known: await existing('parts'),
    key: (p) => str(p.id),
    what: (p) => `Запчасть «${str(p.model)} ${str(p.name)}»`,
    build: (p) => ({
      model: str(p.model), name: str(p.name), category: str(p.category), supplier: str(p.supplier),
      cost: num(p.cost), stock: num(p.stock), comment: str(p.comment), legacyId: str(p.id),
    }),
  });

  // --- заказы: номер сохраняется ---
  const orders = await existing('orders');
  const taken = new Set((await api.list('orders', 'num')).map((o) => o.num));
  const oldOrders = arr(json.orders);
  const buildOrder = (o) => {
    if (str(o.clientId) && !clients.has(str(o.clientId))) throw new Error('клиент не перенесён');
    const status = STATUSES.includes(o.status) ? o.status : 'new';
    const master = str(o.master);
    const who = userOf(master);
    const manual = o.masterPayManual;
    const data = {
      client: clients.get(str(o.clientId)) || '',
      point: pointOf(o.point),
      status,
      source: str(o.source),
      model: str(o.device),
      fault: str(o.repair),
      note: str(o.note),
      approxPrice: num(o.price),
      price: num(o.price),
      courier: num(o.extra),
      payMethod: METHODS.includes(o.payMethod) ? o.payMethod : '',
      warranty: num(o.warranty),
      due: oldDate(o.due),
      acceptedBy: who, acceptedName: master,
      repairedBy: who, repairedName: master,
      masterPayManual: manual === null || manual === undefined || manual === '' || !Number.isFinite(Number(manual)) ? null : Number(manual),
      legacyId: str(o.id),
    };
    const accepted = oldDate(o.createdAt) || oldDate(o.created);
    if (accepted) data.acceptedAt = accepted;
    if (status === 'ready' || status === 'issued') {
      // без даты выдачи — берём дату приёма, иначе заказ «выдался бы» сегодня и исказил финансы
      const issued = oldDate(o.issuedAt) || oldDate(o.issued) || accepted;
      if (issued) data.issuedAt = issued;
    }
    const n = planned.get(o);
    if (n) data.num = n;
    return data;
  };
  const noIssueDate = (o) => ['ready', 'issued'].includes(o.status) && !oldDate(o.issuedAt) && !oldDate(o.issued);
  // Номера раздаём заранее и по порядку: свободный старый номер сохраняется, повтор/занятый — без номера.
  const planned = new Map();
  for (const o of oldOrders) {
    const n = num(o.num);
    if (n > 0 && !taken.has(n)) { taken.add(n); planned.set(o, n); }
  }
  const orderOpts = {
    known: orders, key: (o) => str(o.id), what: (o) => `Заказ №${num(o.num) || '?'}`, build: buildOrder,
    done: (o, rec) => {
      if (noIssueDate(o)) report.notes.push(`Заказ №${rec.num}: в старой версии нет даты выдачи — поставлена дата приёма.`);
      if (num(o.num) > 0 && rec.num !== num(o.num)) report.notes.push(`Заказ №${num(o.num)}: номер уже занят в новой CRM — присвоен №${rec.num}.`);
    },
  };
  // Сначала заказы с сохранёнными номерами; остальные — по одному (сервер даёт «последний + 1», параллельно нельзя).
  await pass('orders', 'Заказы', 'orders', oldOrders.filter((o) => planned.has(o)), orderOpts);
  await pass('orders', 'Заказы', 'orders', oldOrders.filter((o) => !planned.has(o)), { ...orderOpts, chunk: 1 });

  // --- запчасти заказов (склад не трогается: legacyKey) ---
  const opItems = [];
  for (const o of oldOrders) arr(o.parts).forEach((p, i) => opItems.push({ o, p, key: `${str(o.id)}:${i}` }));
  await pass('orderParts', 'Запчасти заказов', 'order_parts', opItems, {
    known: await existing('order_parts', 'legacyKey'),
    key: (x) => x.key,
    what: (x) => `Запчасть «${str(x.p.name)}» в заказе №${num(x.o.num)}`,
    build: ({ o, p, key }) => {
      const order = orders.get(str(o.id));
      if (!order) throw new Error('заказ не перенесён');
      return { order, part: parts.get(str(p.partId)) || '', name: str(p.name), qty: num(p.qty) || 1, cost: num(p.cost), legacyKey: key };
    },
  });

  // --- оплаты ---
  const numByOld = new Map(oldOrders.map((o) => [str(o.id), num(o.num)]));
  await pass('payments', 'Оплаты', 'payments', arr(json.payments), {
    known: await existing('payments'),
    key: (p) => str(p.id),
    what: (p) => `Оплата ${num(p.amount)} ₽ по заказу №${numByOld.get(str(p.orderId)) || '?'}`,
    build: (p) => {
      const order = orders.get(str(p.orderId));
      if (!order) throw new Error('заказ не перенесён');
      const data = { order, amount: num(p.amount), method: str(p.method), legacyId: str(p.id) };
      const at = oldDate(p.at) || oldDate(p.date);
      if (at) data.at = at;
      return data;
    },
  });

  // --- касса ---
  await pass('cash', 'Касса', 'cash_ops', arr(json.cash), {
    known: await existing('cash_ops'),
    key: (c) => str(c.id),
    what: (c) => `Запись кассы ${num(c.amount)} ₽ (${str(c.who)})`,
    build: (c) => {
      const kind = KINDS.includes(c.kind) ? c.kind : 'expense';
      return {
        point: pointOf(c.point), kind, category: kind === 'expense' ? 'Прочее' : '',
        user: kind === 'salary' ? userOf(c.who) : '', who: str(c.who),
        amount: num(c.amount), date: oldDate(c.date), fromCash: true, legacyId: str(c.id),
      };
    },
  });

  // --- штрафы ---
  await pass('fines', 'Штрафы', 'fines', arr(json.fines), {
    known: await existing('fines'),
    key: (f) => str(f.id),
    what: (f) => `Штраф ${num(f.amount)} ₽ (${str(f.master)})`,
    build: (f) => ({ user: userOf(f.master), userName: str(f.master), amount: num(f.amount), reason: str(f.reason), date: oldDate(f.date), legacyId: str(f.id) }),
  });

  // --- реквизиты: только в пустые поля, чтобы повторный перенос не затирал правки ---
  const s = json.settings || {};
  try {
    const st = (await api.list('settings', 'id,org,inn'))[0];
    const patch = {};
    if (st && !str(st.org) && str(s.org)) patch.org = str(s.org);
    if (st && !str(st.inn) && str(s.inn)) patch.inn = str(s.inn);
    if (st && Object.keys(patch).length) await api.update('settings', st.id, patch);
    if (str(s.phone)) {
      for (const p of await api.list('points', 'id,phone')) {
        if (!str(p.phone)) await api.update('points', p.id, { phone: str(s.phone) });
      }
    }
  } catch (e) {
    if (isNetErr(e)) throw new Error(NET_STOP);
    report.errors.push({ what: 'Реквизиты и телефоны точек', text: errText(e) });
  }
  if (str(s.template)) report.notes.push('Шаблон бланка не переносится: в новой версии свой шаблон с новыми полями.');
  tick('Реквизиты');
  return report;
}
