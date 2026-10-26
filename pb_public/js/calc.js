// Денежные формулы CRM «Эксперт». Чистый модуль: без DOM и сети.
// data — объект в форме store.data: { orders, order_parts, payments, sales, cash_ops, fines, users, points, settings, ... }.
// Все суммы — целые рубли.
import { toDate } from './fmt.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const list = (data, name) => (data && Array.isArray(data[name]) ? data[name] : []);
const byId = (arr, id) => (id ? arr.find((x) => x.id === id) : undefined);

// ---------- заказы ----------

// Себестоимость строки запчасти заказа: qty × cost.
export function partLineCost(p) {
  return num(p.qty) * num(p.cost);
}

export function partsCost(o, data) {
  let s = 0;
  for (const p of list(data, 'order_parts')) if (p.order === o.id) s += partLineCost(p);
  return s;
}

export function profit(o, data) {
  return num(o.price) - partsCost(o, data) - num(o.courier);
}

export function rate(pointId, data) {
  const p = byId(list(data, 'points'), pointId);
  return p ? num(p.rate) : 0;
}

export function isOwner(userId, data) {
  const u = byId(list(data, 'users'), userId);
  return !!u && u.role === 'owner';
}

export function hasManualPay(o) {
  const v = o.masterPayManual;
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
}

export function masterPay(o, data) {
  if (isWarranty(o)) return 0;
  if (hasManualPay(o)) return Math.round(Number(o.masterPayManual));
  if (isOwner(o.repairedBy, data)) return 0;
  return Math.round(Math.max(0, profit(o, data)) * rate(o.point, data));
}

export function ownerFromOrder(o, data) {
  return profit(o, data) - masterPay(o, data);
}

// Оплачено по заказу: сумма payments.
export function orderPaid(o, data) {
  let s = 0;
  for (const p of list(data, 'payments')) if (p.order === o.id) s += num(p.amount);
  return s;
}

// Сумма к оплате по заказу: точная цена, а если её нет — примерная.
export function orderBase(o) {
  return num(o.price) || num(o.approxPrice);
}

// Долг по заказу: orderBase − оплачено, не меньше 0. Отказ — 0.
export function orderDebt(o, data) {
  if (o.status === 'refuse') return 0;
  return Math.max(0, orderBase(o) - orderPaid(o, data));
}

// Сводка по клиенту: заказов, принёс (все оплаты), долг (сумма orderDebt), дата последнего заказа.
export function clientSummary(clientId, data) {
  const orders = list(data, 'orders').filter((o) => o.client === clientId);
  let money = 0;
  let debt = 0;
  let last = '';
  for (const o of orders) {
    money += orderPaid(o, data);
    debt += orderDebt(o, data);
    const d = o.acceptedAt || o.created || '';
    if (d > last) last = d;
  }
  return { repairs: orders.length, money, debt, last };
}

// ---------- сроки, забытые, гарантия ----------

const ACTIVE = { new: 1, diag: 1, wait: 1, work: 1 };
const DAY = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Просрочен: срок раньше начала сегодняшнего дня, а заказ ещё не готов/выдан/отказ.
export function isOverdue(o, now = new Date()) {
  const due = toDate(o.due);
  return !!due && !!ACTIVE[o.status] && due < startOfDay(toDate(now));
}

// На сколько дней просрочен (0 — не просрочен).
export function overdueDays(o, now = new Date()) {
  if (!isOverdue(o, now)) return 0;
  return Math.max(1, Math.round((startOfDay(toDate(now)) - startOfDay(toDate(o.due))) / DAY));
}

// Через сколько дней «Готов» считается забытым: settings.forgotDays, по умолчанию 7.
export function forgotDays(data) {
  const s = list(data, 'settings')[0];
  const n = s ? Number(s.forgotDays) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 7;
}

// Забыт: «Готов» не меньше days дней (с readyAt, у старых — с updated).
export function isForgotten(o, now = new Date(), days = 7) {
  if (o.status !== 'ready') return false;
  const since = toDate(o.readyAt) || toDate(o.updated);
  return !!since && since.getTime() <= toDate(now).getTime() - num(days) * DAY;
}

export function isWarranty(o) {
  return !!(o && o.warrantyOf);
}

// Гарантия действует до: issuedAt + warranty мес. (null — не выдан или гарантии нет).
export function warrantyUntil(o) {
  const d = toDate(o.issuedAt);
  const m = num(o.warranty);
  if (!d || m <= 0) return null;
  return new Date(d.getFullYear(), d.getMonth() + m, d.getDate(), d.getHours(), d.getMinutes());
}

export function inWarranty(o, now = new Date()) {
  const u = warrantyUntil(o);
  return !!u && toDate(now) <= u;
}

// ---------- продажи ----------

export function salesRate(data) {
  const s = list(data, 'settings')[0];
  let r = s ? num(s.salesRate) : 0;
  if (r > 1) r = r / 100; // на случай, если процент записан как 10, а не 0.1
  return r;
}

// Сумма продажи: цена за шт. × количество.
export function saleSum(s) {
  return num(s.price) * num(s.qty);
}

export function saleProfit(s) {
  return (num(s.price) - num(s.cost)) * num(s.qty);
}

export function sellerPay(s, data) {
  if (isOwner(s.seller, data)) return 0;
  return Math.round(Math.max(0, saleProfit(s)) * salesRate(data));
}

// Итоги по списку продаж: число продаж, штук, «продано на», прибыль, процент продавцам.
export function salesTotals(sales, data) {
  const t = { count: 0, qty: 0, sum: 0, profit: 0, sellerPay: 0 };
  for (const s of sales || []) {
    t.count++;
    t.qty += num(s.qty);
    t.sum += saleSum(s);
    t.profit += saleProfit(s);
    t.sellerPay += sellerPay(s, data);
  }
  return t;
}

// ---------- склад ----------

// Стоимость склада (запчасти или товары): Σ остаток × закупка; отрицательный остаток — 0.
export function stockValue(items) {
  const v = { total: 0, units: 0, zero: 0 };
  for (const p of items || []) {
    const n = Math.max(0, num(p.stock));
    v.total += n * num(p.cost);
    v.units += n;
    if (n <= 0) v.zero++;
  }
  return v;
}

// ---------- проценты ----------

// Доля → проценты для экрана (0.35 → 35, 0.125 → 12.5).
export const toPct = (share) => Math.round(num(share) * 10000) / 100;
// Проценты из поля ввода → доля для записи (35 → 0.35).
export const fromPct = (pct) => Math.round(num(pct) * 100) / 10000;

// ---------- периоды (местное время, from включительно, to — нет) ----------

// Разбор дат — общий с интерфейсом (fmt.js); calc.toDate оставлен для вкладок.
export { toDate };

// kind: 'day' | 'week' | 'month' | 'range'. Для 'range' date — «с», until — «по» (оба дня входят; перепутанные — меняются местами).
export function periodRange(kind, date, until) {
  const d = toDate(date) || new Date();
  let from;
  let to;
  if (kind === 'range') {
    const e = toDate(until) || d;
    const [a, b] = e < d ? [e, d] : [d, e];
    from = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    to = new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1);
  } else if (kind === 'month') {
    from = new Date(d.getFullYear(), d.getMonth(), 1);
    to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  } else if (kind === 'week') {
    const back = (d.getDay() + 6) % 7; // пн = 0
    from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
    to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
  } else {
    from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return { from, to };
}

// Дата в соседнем периоде: step = -1 назад, +1 вперёд.
export function periodShift(kind, date, step) {
  const d = toDate(date) || new Date();
  // месяц: число сохраняется (31 января → 28/29 февраля), чтобы после «← →» и переключения на «День» не стоять на 1-м
  if (kind === 'month') {
    const last = new Date(d.getFullYear(), d.getMonth() + step + 1, 0).getDate();
    return new Date(d.getFullYear(), d.getMonth() + step, Math.min(d.getDate(), last));
  }
  if (kind === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * step);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + step);
}

// Свой период «с … по …» стрелками сдвигается на свою длину: 1–10 октября → 11–20 октября. → [с, по] (по — включительно).
export function rangeShift(from, until, step) {
  const { from: a, to: b } = periodRange('range', from, until);
  const days = Math.round((b - a) / 86400000);
  const s = new Date(a.getFullYear(), a.getMonth(), a.getDate() + days * step);
  return [s, new Date(s.getFullYear(), s.getMonth(), s.getDate() + days - 1)];
}

export function inPeriod(v, from, to) {
  const d = toDate(v);
  if (!d) return false;
  return (!from || d >= from) && (!to || d < to);
}

// ---------- мастера ----------

const normName = (s) => String(s || '').trim().toLowerCase();

// Ключ мастера: id учётки, если есть; иначе 'name:' + имя (без пробелов по краям, без учёта регистра).
export function masterKey(userId, name) {
  if (userId) return userId;
  const n = normName(name);
  return n ? 'name:' + n : '';
}

// Выданные заказы с датой выдачи в периоде.
export function issuedOrders(data, from, to, pointId) {
  return list(data, 'orders').filter((o) => o.status === 'issued' && inPeriod(o.issuedAt, from, to)
    && (!pointId || o.point === pointId));
}

// ---------- сводка за период ----------

// finance({data, pointId, from, to}) — pointId пустой = все точки.
// Штрафы не привязаны к точке и учитываются при любом фильтре; выплаты ЗП — по точке записи кассы.
// Для месяца, закрытого в month_closes, возвращается снимок на момент закрытия (+ closed: true).
export function finance({ data, pointId = '', from, to }) {
  const snap = closedSnapshot(data, from, to);
  const f = snap && snap.points && snap.points[pointId || ''];
  if (f) return { ...f, closed: true };
  return financeLive({ data, pointId, from, to });
}

function financeLive({ data, pointId = '', from, to }) {
  const pt = (p) => !pointId || p === pointId;
  const users = list(data, 'users');
  const orders = issuedOrders(data, from, to, pointId);
  const orderPoint = new Map(list(data, 'orders').map((o) => [o.id, o.point]));
  const payments = list(data, 'payments').filter((p) => inPeriod(p.at, from, to) && pt(orderPoint.get(p.order)));
  const sales = list(data, 'sales').filter((s) => inPeriod(s.at, from, to) && pt(s.point));
  const cash = list(data, 'cash_ops').filter((c) => inPeriod(c.date, from, to) && pt(c.point));
  const fines = list(data, 'fines').filter((f) => inPeriod(f.date, from, to));

  const masters = new Map();
  const get = (key, name) => {
    if (!key) return null;
    let m = masters.get(key);
    if (!m) {
      const u = byId(users, key);
      m = { key, userId: u ? u.id : '', name: u ? (u.name || u.email || '—') : String(name || '').trim() || '—',
        repairs: 0, profit: 0, accrued: 0, fines: 0, paid: 0, due: 0, warranties: 0, orders: [], sales: [], fineList: [] };
      masters.set(key, m);
    }
    return m;
  };
  for (const u of users) if (u.role === 'master' && u.active !== false) get(u.id);

  let repairsProfit = 0;
  let masterPayTotal = 0;
  let ownerOrders = 0;
  let priceTotal = 0;
  let warrantyCost = 0;
  let warrantyCount = 0;
  for (const o of orders) {
    if (isWarranty(o)) {
      warrantyCost += partsCost(o, data) + num(o.courier);
      warrantyCount++;
      continue;
    }
    const pr = profit(o, data);
    priceTotal += num(o.price);
    const pay = masterPay(o, data);
    repairsProfit += pr;
    masterPayTotal += pay;
    ownerOrders += pr - pay;
    const m = get(masterKey(o.repairedBy, o.repairedName), o.repairedName);
    if (m) { m.repairs++; m.profit += pr; m.accrued += pay; m.orders.push(o); }
  }
  // Гарантийные возвраты — мастеру исходного ремонта, по дате приёма гарантийного заказа.
  const allOrders = list(data, 'orders');
  for (const w of allOrders) {
    if (!isWarranty(w) || !pt(w.point) || !inPeriod(w.acceptedAt || w.created, from, to)) continue;
    const src = byId(allOrders, w.warrantyOf);
    const m = src && get(masterKey(src.repairedBy, src.repairedName), src.repairedName);
    if (m) m.warranties++;
  }

  const st = salesTotals(sales, data);
  const salesTotal = st.sum;
  const salesProfit = st.profit;
  const sellerPayTotal = st.sellerPay;
  for (const s of sales) {
    const m = get(masterKey(s.seller, ''));
    if (m) { m.accrued += sellerPay(s, data); m.sales.push(s); }
  }

  let expenses = 0;
  const cats = new Map();
  for (const c of cash) {
    if (c.kind === 'expense') {
      expenses += num(c.amount);
      const k = c.category || 'Прочее';
      cats.set(k, (cats.get(k) || 0) + num(c.amount));
    }
    if (c.kind === 'salary') {
      const m = get(masterKey(c.user, c.who), c.who);
      if (m) m.paid += num(c.amount);
    }
  }
  for (const f of fines) {
    const m = get(masterKey(f.user, f.userName), f.userName);
    if (m) { m.fines += num(f.amount); m.fineList.push(f); }
  }

  const list_ = [...masters.values()];
  for (const m of list_) m.due = m.accrued - m.fines - m.paid;
  list_.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const paymentsTotal = payments.reduce((s, p) => s + num(p.amount), 0);
  return {
    turnover: paymentsTotal + salesTotal,
    paymentsTotal, salesTotal,
    repairs: orders.length - warrantyCount, repairsProfit, masterPayTotal,
    avgCheck: orders.length > warrantyCount ? Math.round(priceTotal / (orders.length - warrantyCount)) : 0,
    salesProfit, sellerPayTotal,
    staffPayTotal: masterPayTotal + sellerPayTotal,
    expenses,
    expensesByCategory: [...cats].sort((a, b) => b[1] - a[1]),
    warrantyCost, warrantyCount,
    profitTotal: repairsProfit + salesProfit - expenses - warrantyCost,
    ownerShare: ownerOrders + (salesProfit - sellerPayTotal) - expenses - warrantyCost,
    bySource: bySource(data, pointId, from, to),
    masters: list_,
  };
}

// Источник заказа: orders.source, иначе источник клиента, иначе «Не указан».
export function orderSource(o, data) {
  const c = byId(list(data, 'clients'), o.client);
  return String(o.source || (c && c.source) || '').trim() || 'Не указан';
}

// «Откуда клиенты» за период: новых (по acceptedAt), выдано, оборот (Σ цен выданных), прибыль, средний чек.
// Гарантийные заказы не учитываются. Сортировка по прибыли, затем по числу новых.
export function bySource(data, pointId, from, to) {
  const rows = new Map();
  const row = (o) => {
    const k = orderSource(o, data);
    if (!rows.has(k)) rows.set(k, { source: k, newOrders: 0, issued: 0, turnover: 0, profit: 0, avgCheck: 0 });
    return rows.get(k);
  };
  for (const o of list(data, 'orders')) {
    if (isWarranty(o) || (pointId && o.point !== pointId)) continue;
    if (inPeriod(o.acceptedAt || o.created, from, to)) row(o).newOrders++;
    if (o.status === 'issued' && inPeriod(o.issuedAt, from, to)) {
      const r = row(o);
      r.issued++;
      r.turnover += num(o.price);
      r.profit += profit(o, data);
    }
  }
  const out = [...rows.values()];
  for (const r of out) r.avgCheck = r.issued ? Math.round(r.turnover / r.issued) : 0;
  return out.sort((a, b) => b.profit - a.profit || b.newOrders - a.newOrders || a.source.localeCompare(b.source, 'ru'));
}

// masterStats(data, keyOrName, from, to) — keyOrName: id учётки, 'name:…' или просто имя. Все точки.
export function masterStats(data, keyOrName, from, to) {
  let key = String(keyOrName || '');
  if (!byId(list(data, 'users'), key) && !key.startsWith('name:')) key = masterKey('', key);
  const f = finance({ data, pointId: '', from, to });
  const m = f.masters.find((x) => x.key === key);
  if (m) return m;
  const u = byId(list(data, 'users'), key);
  return { key, userId: u ? u.id : '', name: u ? u.name : key.replace(/^name:/, ''),
    repairs: 0, profit: 0, accrued: 0, fines: 0, paid: 0, due: 0, warranties: 0, orders: [], sales: [], fineList: [] };
}

// ---------- закрытие месяца ----------

// Месяц для закрытия считается по времени Кемерово (UTC+7) — как на сервере (pb_hooks/lib/expert.js monthBounds),
// независимо от часового пояса браузера или машины.
export const MONTH_TZ_HOURS = 7;
const TZ_MS = MONTH_TZ_HOURS * 3600000;

// Date → 'ГГГГ-ММ' по UTC+7.
export function monthKey(date) {
  const d = new Date((toDate(date) || new Date()).getTime() + TZ_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 'ГГГГ-ММ' → {from, to}: границы месяца по UTC+7 (to не входит).
export function monthRange(key) {
  const [y, m] = String(key).split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1) - TZ_MS), to: new Date(Date.UTC(y, m, 1) - TZ_MS) };
}

// Снимок закрытого месяца, если период [from, to) — ровно месяц из data.month_closes
// (границы по UTC+7 или границы того же месяца в местном времени, как periodRange('month')).
export function closedSnapshot(data, from, to) {
  const closes = list(data, 'month_closes');
  const f = toDate(from), t = toDate(to);
  if (!closes.length || !f || !t) return null;
  const local = periodRange('month', f);
  const keys = [monthKey(f), `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`];
  for (const key of keys) {
    const r = key === keys[0] ? monthRange(key) : local;
    if (f.getTime() !== r.from.getTime() || t.getTime() !== r.to.getTime()) continue;
    const c = closes.find((x) => x.month === key);
    if (c && c.snapshot) return c.snapshot;
  }
  return null;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const ORDER_KEYS = ['id', 'num', 'point', 'client', 'deviceType', 'model', 'price', 'courier', 'status', 'issuedAt', 'acceptedAt',
  'repairedBy', 'repairedName', 'masterPayManual', 'warrantyOf', 'source'];
const SALE_KEYS = ['id', 'product', 'qty', 'price', 'cost', 'point', 'seller', 'method', 'at'];
const FINE_KEYS = ['id', 'user', 'userName', 'amount', 'reason', 'date'];

// orders[].pay — ЗП мастера за заказ на момент закрытия (чтобы смена ставки не меняла строки закрытого месяца).
function leanFinance(f, data) {
  return { ...f, masters: f.masters.map((m) => ({ ...m,
    orders: m.orders.map((o) => ({ ...pick(o, ORDER_KEYS), pay: masterPay(o, data) })),
    sales: m.sales.map((s) => pick(s, SALE_KEYS)),
    fineList: m.fineList.map((x) => pick(x, FINE_KEYS)) })) };
}

// Снимок месяца для month_closes.snapshot: finance по «все» (ключ '') и по каждой точке, с мастерами.
// → { month, from, to, points: { '': finance, [pointId]: finance } } — JSON-совместимый.
export function monthSnapshot(data, key) {
  const { from, to } = monthRange(key);
  const points = { '': leanFinance(financeLive({ data, pointId: '', from, to }), data) };
  for (const p of list(data, 'points')) points[p.id] = leanFinance(financeLive({ data, pointId: p.id, from, to }), data);
  return { month: key, from: from.toISOString(), to: to.toISOString(), points };
}

// ---------- Главная ----------

// Наличные в кассе точки сейчас (как cashMonth.closing): нал-оплаты заказов + нал-продажи − записи кассы с fromCash.
export function cashBalance(data, pointId, now = new Date()) {
  const end = toDate(now);
  const pt = (p) => !pointId || p === pointId;
  const upTo = (v) => { const d = toDate(v); return !!d && d <= end; };
  const orderPoint = new Map(list(data, 'orders').map((o) => [o.id, o.point]));
  let s = 0;
  for (const p of list(data, 'payments')) if (p.method === 'Нал' && pt(orderPoint.get(p.order)) && upTo(p.at || p.created)) s += num(p.amount);
  for (const x of list(data, 'sales')) if (x.method === 'Нал' && pt(x.point) && upTo(x.at || x.created)) s += saleSum(x);
  for (const c of list(data, 'cash_ops')) if (c.fromCash && pt(c.point) && upTo(c.date || c.created)) s -= num(c.amount);
  return s;
}

// Сводка «Главной» по точке (pointId пустой — все точки).
// lowStock: запчасти и товары точки с остатком ≤ 1 → [{kind:'part'|'product', id, name, stock, item}], по остатку.
export function pointDashboard(data, pointId, now = new Date()) {
  const { from, to } = periodRange('day', now);
  const orders = list(data, 'orders').filter((o) => !pointId || o.point === pointId);
  const cnt = (fn) => orders.filter(fn).length;
  const days = forgotDays(data);
  const dueOf = (o) => (toDate(o.due) || 0).valueOf();
  const low = [];
  for (const [kind, col] of [['part', 'parts'], ['product', 'products']]) {
    for (const it of list(data, col)) {
      if ((pointId && it.point !== pointId) || num(it.stock) > 1) continue;
      const name = kind === 'part' ? [it.model, it.name].filter(Boolean).join(' ') : String(it.name || '');
      low.push({ kind, id: it.id, name, stock: num(it.stock), item: it });
    }
  }
  low.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, 'ru'));
  return {
    acceptedToday: cnt((o) => inPeriod(o.acceptedAt, from, to)),
    issuedToday: cnt((o) => o.status === 'issued' && inPeriod(o.issuedAt, from, to)),
    inWork: cnt((o) => o.status === 'new' || o.status === 'diag' || o.status === 'work'),
    waitingParts: cnt((o) => o.status === 'wait'),
    ready: cnt((o) => o.status === 'ready'),
    overdue: orders.filter((o) => isOverdue(o, now)).sort((a, b) => dueOf(a) - dueOf(b)),
    forgotten: orders.filter((o) => isForgotten(o, now, days))
      .sort((a, b) => String(a.readyAt || a.updated).localeCompare(String(b.readyAt || b.updated))),
    cashNow: cashBalance(data, pointId, now),
    turnoverToday: financeLive({ data, pointId, from, to }).turnover,
    lowStock: low,
  };
}
