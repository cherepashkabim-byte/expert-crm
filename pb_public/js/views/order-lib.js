// Чистые помощники заказов: справочники, поиск клиента, бланк приёма.
// Без DOM и сети — импортируется и во вкладках, и в node-тестах (поэтому не тянет ui.js/store.js).
import { esc, money, fmtDate, fmtPhone, normPhone, phoneMatch, toDate, plural } from '../fmt.js';
import {
  orderPaid, orderDebt, isOverdue, isForgotten, warrantyUntil, partsCost, profit, masterPay, orderSource, partLineCost, masterKey,
} from '../calc.js';
import { normDevice, orderDevice } from './order-hints.js';

export const STATUSES = [
  ['new', 'Новый'], ['diag', 'Диагностика'], ['wait', 'Ждёт запчасть'], ['work', 'В ремонте'],
  ['ready', 'Готов'], ['issued', 'Выдан'], ['refuse', 'Отказ'],
];
export const STATUS_LABEL = Object.fromEntries(STATUSES);
export const SOURCES = ['Сарафан', '2GIS', 'Авито', 'Яндекс', 'Instagram', 'Telegram', 'VK', 'Проходил мимо', 'Сайт', 'Прочее'];
export const SITE_SOURCE = 'Сайт';
export const DEVICE_TYPES = ['Телефон', 'Планшет', 'Ноутбук', 'Часы', 'Наушники', 'Другое'];
export const PAY_METHODS = ['Нал', 'Перевод', 'Терминал'];
export const BLANK = '____________';
export const SERVICE = '«Эксперт»';

const list = (data, name) => (data && Array.isArray(data[name]) ? data[name] : []);
const byId = (arr, id) => (id ? arr.find((x) => x.id === id) : undefined) || null;

// Ключ телефона — та же функция, что ui.normPhone (fmt.normPhone).
export const phoneKey = normPhone;
// Оплачено по заказу — формула в calc (здесь для старых импортов).
export { orderPaid };

export function findClient(clients, phone) {
  const k = phoneKey(phone);
  if (k.length < 5) return null;
  return (clients || []).find((c) => (c.phoneDigits || phoneKey(c.phone)) === k) || null;
}

// Имя сотрудника по учётке, а для старых заказов без учётки — сохранённое имя.
export function personName(id, name, data) {
  const u = byId(list(data, 'users'), id);
  return u ? (u.name || u.email || '') : String(name || '');
}

export function clientOrders(clientId, data) {
  return list(data, 'orders').filter((o) => o.client === clientId)
    .sort((a, b) => (Number(b.num) || 0) - (Number(a.num) || 0));
}

// ---------- бланк ----------

export function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) =>
    (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

export function blankHtml(tpl, vars) {
  const body = fillTemplate(tpl, vars).split(/\r?\n/).map((line) => {
    if (/^#\s/.test(line)) return `<h2>${esc(line.replace(/^#\s+/, ''))}</h2>`;
    return line.trim() ? `<p>${esc(line)}</p>` : '<p>&nbsp;</p>';
  }).join('');
  return `<div class="contract">${body}</div>`;
}

export function blankVars(o, data) {
  const or = (v) => (v === null || v === undefined || String(v).trim() === '' ? BLANK : String(v));
  const cl = byId(list(data, 'clients'), o.client) || {};
  const pt = byId(list(data, 'points'), o.point) || {};
  const st = list(data, 'settings')[0] || {};
  const paid = orderPaid(o, data);
  const price = Number(o.price) || 0;
  const hasPrice = price || Number(o.approxPrice);
  const works = list(data, 'order_parts').filter((p) => p.order === o.id && String(p.name || '').trim())
    .map((p) => (Number(p.qty) > 1 ? `${p.name} (${p.qty} шт.)` : p.name));
  return {
    номер: String(o.num ?? ''),
    дата: fmtDate(o.acceptedAt || o.created) || fmtDate(new Date()),
    сервис: SERVICE,
    организация: or(st.org),
    инн: or(st.inn),
    клиент: or(cl.name),
    телефон: or(fmtPhone(cl.phone)),
    тип: or(o.deviceType),
    марка: or(normDevice(o.brand, o.model).brand),
    модель: or(orderDevice(o)), // марка + модель: «Apple iPhone 13»
    цвет: or(o.color),
    внешний_вид: or(o.appearance),
    неисправность: or(o.fault),
    примерная_цена: Number(o.approxPrice) ? money(o.approxPrice) : BLANK,
    цена: o.warrantyOf ? `${money(0)} (гарантийный ремонт)` : (price ? money(price) : BLANK),
    предоплата: money(paid),
    остаток: hasPrice ? money(orderDebt(o, data)) : BLANK,
    срок: or(fmtDate(o.due)),
    гарантия: Number(o.warranty) ? String(o.warranty) : BLANK,
    принял: or(personName(o.acceptedBy, o.acceptedName, data)),
    мастер: or(personName(o.repairedBy, o.repairedName, data)),
    адрес: or(pt.address || pt.name),
    телефон_точки: or(fmtPhone(pt.phone)),
    дата_выдачи: or(fmtDate(o.issuedAt)),
    // для акта выдачи
    работы: works.length ? works.join(', ') : 'ремонт по заявленной неисправности',
    оплачено: money(paid),
    способ_оплаты: or(o.payMethod),
    гарантия_до: or(fmtDate(warrantyUntil(o))),
  };
}

// ---------- общие куски разметки (заказы и клиенты) ----------

export function statusChip(s, attrs = '') {
  return `<span class="chip st-${esc(s)}"${attrs}>${esc(STATUS_LABEL[s] || s || '—')}</span>`;
}

export const deviceText = (o) => [o.deviceType, orderDevice(o)].filter(Boolean).join(' ') || '—';

// Таблица прошлых ремонтов клиента; строки кликабельны через data-order.
export function historyTable(orders, data) {
  if (!orders.length) return '';
  const rows = orders.map((o) => {
    const price = Number(o.price) ? money(o.price) : (Number(o.approxPrice) ? '~' + money(o.approxPrice) : '—');
    return `<tr class="click" data-order="${esc(o.id)}"><td>№ ${esc(o.num)}</td><td>${esc(fmtDate(o.acceptedAt || o.created))}</td>
      <td>${esc(deviceText(o))}</td><td class="wrap">${esc(o.fault || '—')}</td><td>${statusChip(o.status)}${o.warrantyOf ? '<div class="ord-mark">гарантия</div>' : ''}</td><td class="num">${price}</td></tr>`;
  }).join('');
  return `<div class="tw"><table><thead><tr><th>№</th><th>Дата</th><th>Устройство</th><th>Неисправность</th><th>Статус</th><th class="num">Цена</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// ---------- список заказов ----------

// Подходит ли заказ под поиск: №, ФИО, устройство, цифры телефона (8/7 в начале одинаковы).
export function orderMatches(o, q, data) {
  if (!q) return true;
  const c = (data.clients || []).find((x) => x.id === o.client) || {};
  const s = q.toLowerCase();
  if (String(o.num ?? '').includes(s)) return true;
  if (String(c.name || '').toLowerCase().includes(s)) return true;
  if (`${o.deviceType || ''} ${orderDevice(o)}`.toLowerCase().includes(s)) return true;
  if (phoneMatch(c.phoneDigits || c.phone, s)) return true;
  return false;
}

// Заказы точки point ('' — все точки) под поиском q; elsewhere — сколько совпадений в других точках.
export function orderList(orders, data, { point = '', q = '' } = {}) {
  const s = String(q).trim();
  const found = orders.filter((o) => orderMatches(o, s, data));
  const rows = point ? found.filter((o) => o.point === point) : found;
  return { rows, elsewhere: point && s ? found.length - rows.length : 0 };
}

// ---------- фильтры «Просрочено» / «Забыто» ----------

// filter: '' — все, ключ статуса, 'overdue' — просрочено, 'forgotten' — забыто (days — settings.forgotDays).
export function matchFilter(o, filter, now = new Date(), days = 7) {
  if (!filter) return true;
  if (filter === 'overdue') return isOverdue(o, now);
  if (filter === 'forgotten') return isForgotten(o, now, days);
  return o.status === filter;
}

// Счётчики для чипов: по статусам + overdue + forgotten.
export function filterCounts(orders, now = new Date(), days = 7) {
  const n = { overdue: 0, forgotten: 0 };
  for (const o of orders) {
    n[o.status] = (n[o.status] || 0) + 1;
    if (isOverdue(o, now)) n.overdue++;
    if (isForgotten(o, now, days)) n.forgotten++;
  }
  return n;
}

// ---------- фильтры «Принял» / «Мастер» ----------

// Ключ сотрудника — как ключ мастера в calc: id учётки, иначе 'name:' + имя без учёта регистра ('' — никто).
export const personKey = (id, name) => masterKey(id, name);
const PERSON = { acc: ['acceptedBy', 'acceptedName'], rep: ['repairedBy', 'repairedName'] };
const roleKey = (o, role) => personKey(o[PERSON[role][0]], o[PERSON[role][1]]);
export const NO_MASTER = '-';

// Кто принимал (role 'acc') или ремонтировал ('rep') заказы: [{key, name, n}], больше заказов — выше.
// У мастера заказы без мастера — {key: '-', name: 'Не назначен'} в конце; у принявшего пустые не считаются.
export function peopleOptions(orders, data, role) {
  const [idF, nameF] = PERSON[role] || PERSON.acc;
  const m = new Map();
  for (const o of orders || []) {
    const k = personKey(o[idF], o[nameF]) || (role === 'rep' ? NO_MASTER : '');
    if (!k) continue;
    const cur = m.get(k) || { key: k, name: k === NO_MASTER ? 'Не назначен' : personName(o[idF], String(o[nameF] || '').trim(), data) || k, n: 0 };
    cur.n++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => (a.key === NO_MASTER) - (b.key === NO_MASTER) || b.n - a.n || a.name.localeCompare(b.name, 'ru'));
}

// Подходит ли заказ под фильтр людей: acc/rep — ключи personKey ('' — все; rep '-' — без мастера).
export function matchPeople(o, { acc = '', rep = '' } = {}) {
  if (acc && roleKey(o, 'acc') !== acc) return false;
  if (rep && (roleKey(o, 'rep') || NO_MASTER) !== rep) return false;
  return true;
}

// ---------- гарантия ----------

// Данные нового заказа-гарантии: клиент, точка, устройство из исходного, цена 0, связь warrantyOf.
export function warrantyDraft(o) {
  return {
    client: o.client || '', point: o.point || '', source: o.source || '', deviceType: o.deviceType || '',
    brand: o.brand || '', model: o.model || '', color: o.color || '', warrantyOf: o.id, price: 0, approxPrice: 0,
  };
}

// Действует ли гарантия исходного заказа: {ok, text}.
export function warrantyCheck(o, now = new Date()) {
  const until = warrantyUntil(o);
  if (!until) return { ok: false, text: 'Срок гарантии у заказа не указан' };
  if (toDate(now) > until) return { ok: false, text: `Срок гарантии истёк ${fmtDate(until)}` };
  return { ok: true, text: `Гарантия до ${fmtDate(until)}` };
}

// ---------- «Напомнить клиенту» ----------

export const REMIND_PAUSE_MS = 24 * 3600 * 1000;

// По журналу заказа: последнее напоминание и до какого времени кнопка заблокирована (null — можно).
export function remindState(log, now = new Date()) {
  let last = null;
  for (const l of log || []) {
    if (l.field !== 'remind') continue;
    const d = toDate(l.at || l.created);
    if (d && (!last || d > last)) last = d;
  }
  const until = last ? new Date(last.getTime() + REMIND_PAUSE_MS) : null;
  return { last, blockedUntil: until && until > toDate(now) ? until : null };
}

// ---------- склад по точкам ----------

const low = (s) => String(s || '').trim().toLowerCase();
export const samePart = (a, b) => low(a.model) === low(b.model) && low(a.name) === low(b.name);

export function partsAtPoint(parts, pointId) {
  return (parts || []).filter((p) => !pointId || p.point === pointId);
}

// Где ещё есть такая же запчасть: «есть на пр-т Советский 24: 3 шт., …» ('' — нигде).
export function stockHint(part, data) {
  const pts = list(data, 'points');
  const found = list(data, 'parts')
    .filter((p) => p.id !== part.id && p.point !== part.point && Number(p.stock) > 0 && samePart(p, part))
    .sort((a, b) => Number(b.stock) - Number(a.stock));
  if (!found.length) return '';
  return 'есть на ' + found.map((p) => `${(byId(pts, p.point) || {}).name || '—'}: ${Number(p.stock)} шт.`).join(', ');
}

// ---------- выгрузка в Excel ----------

// Цвет статуса в таблице — как чипы статусов на экране.
const STATUS_TONE = { new: 'orange', diag: 'blue', wait: 'warn', work: 'purple', ready: 'ok', issued: 'muted', refuse: 'bad' };

// Лист «Заказы» для xlsx.xlsxBook: шапка, ₽, даты, цвет статуса, долг красным, итоги по деньгам.
// meta: { subtitle } — подпись под заголовком (дата выгрузки, точка, фильтр).
export function ordersSheet(orders, data, { subtitle = '' } = {}) {
  const cl = (o) => byId(list(data, 'clients'), o.client) || {};
  const issued = (o) => o.status === 'issued';
  const columns = [
    { title: '№', type: 'int', width: 7 },
    { title: 'Принят', type: 'date', width: 11 },
    { title: 'Клиент', type: 'text', width: 24 },
    { title: 'Телефон', type: 'text', width: 16 },
    { title: 'Устройство', type: 'text', width: 28 },
    { title: 'Неисправность', type: 'text', width: 32, wrap: true },
    { title: 'Статус', type: 'text', width: 14 },
    { title: 'Точка', type: 'text', width: 22 },
    { title: 'Источник', type: 'text', width: 14 },
    { title: 'Цена', type: 'money', width: 12 },
    { title: 'Оплачено', type: 'money', width: 12 },
    { title: 'Долг', type: 'money', width: 12 },
    { title: 'Запчасти', type: 'money', width: 12 },
    { title: 'Прибыль', type: 'money', width: 12 },
    { title: 'ЗП мастера', type: 'money', width: 12 },
    { title: 'Мастер', type: 'text', width: 18 },
    { title: 'Выдан', type: 'date', width: 11 },
    { title: 'Гарантия по №', type: 'text', width: 13 },
  ];
  const rows = orders.map((o) => {
    const debt = orderDebt(o, data);
    const pr = issued(o) ? profit(o, data) : null;
    return [
      Number(o.num) || null,
      toDate(o.acceptedAt || o.created),
      cl(o).name || '',
      fmtPhone(cl(o).phone),
      [o.deviceType, orderDevice(o)].filter(Boolean).join(' '),
      o.fault || '',
      { v: STATUS_LABEL[o.status] || o.status || '', tone: STATUS_TONE[o.status] },
      (byId(list(data, 'points'), o.point) || {}).name || '',
      orderSource(o, data),
      Number(o.price) || 0,
      orderPaid(o, data),
      debt > 0 ? { v: debt, tone: 'bad' } : debt,
      partsCost(o, data),
      pr !== null && pr < 0 ? { v: pr, tone: 'bad' } : pr,
      issued(o) ? masterPay(o, data) : null,
      personName(o.repairedBy, o.repairedName, data),
      toDate(o.issuedAt),
      o.warrantyOf ? String((byId(list(data, 'orders'), o.warrantyOf) || {}).num || '?') : '',
    ];
  });
  return { name: 'Заказы', title: `Заказы — ${orders.length} ${plural(orders.length, 'заказ', 'заказа', 'заказов')}`, subtitle, columns, rows, total: 'Итого', noTotal: [0] };
}

// ---------- заявки с сайта ----------

// Заявка → данные для формы приёма заказа.
export function leadDraft(l) {
  return { name: l.name || '', phone: fmtPhone(l.phone), model: l.device || '', fault: l.problem || '', point: l.point || '', source: SITE_SOURCE, lead: l.id };
}

// ---------- лента истории заказа ----------

// Подписи полей журнала (для заголовков «Изменено: …» и подробностей в карточке).
export const FIELD_LABEL = {
  created: 'Создан', sms: 'СМС', status: 'Статус', client: 'Клиент', point: 'Точка', source: 'Источник',
  deviceType: 'Тип устройства', brand: 'Марка', model: 'Модель', color: 'Цвет', appearance: 'Внешний вид', fault: 'Неисправность',
  approxPrice: 'Примерная цена', acceptedBy: 'Принял', acceptedName: 'Принял (имя)', repairedBy: 'Мастер',
  repairedName: 'Мастер (имя)', price: 'Цена', warranty: 'Гарантия, мес.', courier: 'Курьер', payMethod: 'Форма оплаты',
  due: 'Срок', acceptedAt: 'Принят', issuedAt: 'Выдан', note: 'Заметка', notifySms: 'СМС о готовности',
  masterPayManual: 'ЗП мастера вручную', num: 'Номер', remind: 'Напоминание', photos: 'Фото',
  warrantyOf: 'Гарантия по заказу', readyAt: 'Готов с', quick: 'Быстрый заказ',
};

// Записи журнала, которые не склеиваются в «Изменено»: у каждой своё событие.
const LOG_KIND = {
  created: 'Заказ создан', status: '', sms: 'СМС', remind: 'Напоминание клиенту', comment: 'Комментарий',
  payment: '', 'payment-': '', part: 'Добавлена запчасть', 'part-': 'Убрана запчасть', photos: 'Изменены фото',
};
const GLUE_MS = 3000;
// Отметки времени, которые сервер ставит сам вместе со статусом («Готов с», «Выдан»): в журнале есть, в ленте — шум.
const AUTO_FIELDS = new Set(['readyAt', 'issuedAt']);

// Оплата из журнала «1 000 ₽ · Нал» или из записи payments → поля события.
function payEvent(amount, method) {
  return { amount, method, title: `Оплата ${amount}` };
}

// Лента истории заказа: журнал order_log + (для старых заказов) оплаты и запчасти из данных.
// log — записи order_log; payments/parts — записи этого заказа; names — подписи полей (по умолчанию FIELD_LABEL).
// Правки обычных полей одним человеком подряд в пределах 3 с — одно событие kind 'edit' с items по полям.
// Оплаты/запчасти синтезируются из данных, только если в журнале нет ни одной записи 'payment'/'part'.
// → [{day:'дд.мм.гггг', events:[{id, at, user, kind, title, items:[{field, old, new}], text?, amount?, method?}]}], старые сверху.
export function timeline(log, { payments = [], parts = [] } = {}, names = FIELD_LABEL) {
  // Запись без даты (нет ни at, ни created) пропускается: иначе она уехала бы в 1970 год.
  const time = (v) => { const d = toDate(v); return d ? d.getTime() : NaN; };
  const dated = (v) => Number.isFinite(time(v));
  const rows = (log || []).map((l, i) => ({ l, i, t: time(l.at || l.created) })).filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.l);
  const uid = (u) => (u && typeof u === 'object' ? u.id || '' : u || ''); // всегда id учётки
  const events = [];
  let edit = null;
  let editLast = 0; // время последней правки в склейке: окно 3 с считается от неё
  for (const l of rows) {
    const at = l.at || l.created;
    const base = { id: l.id, at, user: uid(l.user) };
    const f = l.field;
    if (AUTO_FIELDS.has(f)) continue;
    if (!Object.prototype.hasOwnProperty.call(LOG_KIND, f)) {
      if (edit && edit.user === base.user && time(at) - editLast <= GLUE_MS) {
        edit.items.push({ field: f, old: l.old ?? '', new: l.new ?? '' });
      } else {
        edit = { ...base, kind: 'edit', items: [{ field: f, old: l.old ?? '', new: l.new ?? '' }] };
        events.push(edit);
      }
      editLast = time(at);
      continue;
    }
    // Статус того же сохранения не разрывает склейку правок (хук пишет поля вперемешку со статусом).
    if (!(f === 'status' && edit && edit.user === base.user)) edit = null;
    const ev = { ...base, kind: f, title: LOG_KIND[f], items: [] };
    if (f === 'status') {
      ev.title = `Статус: ${STATUS_LABEL[l.new] || l.new || '—'}`;
      ev.items = [{ field: 'status', old: l.old ?? '', new: l.new ?? '' }];
    } else if (f === 'payment' || f === 'payment-') {
      const [amount = '', method = ''] = String((f === 'payment' ? l.new : l.old) || '').split(' · ');
      Object.assign(ev, payEvent(amount, method));
      if (f === 'payment-') ev.title = `Удалена оплата ${amount}`;
    } else if (f === 'part-') ev.text = l.old || '';
    else ev.text = l.new || '';
    events.push(ev);
  }
  const has = (f) => rows.some((l) => l.field === f);
  if (!has('payment')) {
    for (const p of payments || []) {
      if (!dated(p.at || p.created)) continue;
      events.push({ id: `pay:${p.id}`, at: p.at || p.created, user: uid(p.by), kind: 'payment', items: [], ...payEvent(money(p.amount), p.method || '') });
    }
  }
  if (!has('part')) {
    for (const p of parts || []) {
      if (!dated(p.created)) continue; // у order_parts нет автора — user пустой
      events.push({ id: `part:${p.id}`, at: p.created, user: '', kind: 'part', title: LOG_KIND.part, items: [],
        text: `${p.name || 'Запчасть'} × ${Number(p.qty) || 0} · ${money(partLineCost(p))}` });
    }
  }
  for (const e of events) if (e.kind === 'edit') e.title = 'Изменено: ' + e.items.map((x) => names[x.field] || x.field).join(', ');
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => time(a.e.at) - time(b.e.at) || a.i - b.i).map((x) => x.e);
  const days = [];
  for (const e of sorted) {
    const day = fmtDate(e.at) || '—';
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, events: [] });
    days[days.length - 1].events.push(e);
  }
  return days;
}
