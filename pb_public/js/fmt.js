// Форматирование и разбор значений. Чистый модуль без DOM: им пользуются ui, calc, order-lib, cash и node-тесты.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 12345 → «12 345 ₽» (целые рубли).
export const money = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ') + ' ₽';

export const pad = (n) => String(n).padStart(2, '0');

// Строка PocketBase «2026-09-30 12:00:00.000Z», ISO, «2026-09-30» (как местная дата) или Date → Date | null.
export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d) ? null : d;
}

export function fmtDate(v) {
  const d = toDate(v);
  return d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` : '';
}

export function fmtDateTime(v) {
  const d = toDate(v);
  return d ? `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

// Date/строка → 'ГГГГ-ММ-ДД' в местном времени (для <input type="date"> и ключей дня).
export function toInputDate(v) {
  const d = toDate(v);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '';
}

// Из <input type="date"> в значение для поля PocketBase date (местная полночь → UTC). Пусто → ''.
export function fromInputDate(s) {
  const d = toDate(s);
  return d ? d.toISOString() : '';
}

export const today = () => toInputDate(new Date());

// Склонение по числу: plural(3, 'клиент', 'клиента', 'клиентов') → 'клиента'.
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 10;
  const b = Math.abs(n) % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}

export const digits = (s) => String(s ?? '').replace(/\D/g, '');

// Телефон → 7XXXXXXXXXX (8/7/+7/без кода — одинаково, как clients.phoneDigits на сервере);
// что не похоже на российский номер — просто цифры.
export function normPhone(s) {
  let d = digits(s);
  if (d.length === 11 && (d[0] === '8' || d[0] === '7')) d = '7' + d.slice(1);
  else if (d.length === 10) d = '7' + d;
  return d;
}

// Российский номер показываем и сохраняем всегда с 8: «8 900 123-45-67» (+7/7/без кода — то же самое).
// Что не похоже на российский номер — как ввели.
export function fmtPhone(s) {
  const d = normPhone(s);
  if (d.length !== 11 || d[0] !== '7') return String(s ?? '').trim();
  return `8 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
}
// Пока номер набирают: «+7…»/«7…» в начале → «8…», «9…» → «89…»; больше 11 цифр набрать нельзя —
// всё после 11-й цифры отбрасывается (пробелы и дефисы до неё остаются как ввели).
export function phoneTyping(s) {
  const v = String(s ?? '').replace(/^\s*(\+\s*7|7)/, '8').replace(/^\s*9/, '89');
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    if (/\d/.test(v[i]) && ++n === 11) return v.slice(0, i + 1);
  }
  return v;
}

// Номер клиента правильный, если кроме цифр в нём только пробелы, скобки, дефисы и «+»,
// а цифр ровно 11 и первая — 7 или 8.
export const PHONE_ERR = 'Проверьте номер: нужно 11 цифр, например 8 900 123-45-67';
// «-» вместо номера — номер клиента неизвестен: заказ принимается, клиент создаётся без телефона (всегда новый).
export const noPhone = (s) => String(s ?? '').trim() === '-';
export const PHONE_OR_DASH = PHONE_ERR + '. Номер неизвестен — поставьте «-»';
export function phoneValid(s) {
  const str = String(s ?? '');
  if (!/^[\d\s()+-]*$/.test(str)) return false;
  return /^[78]\d{10}$/.test(digits(str));
}

// Поиск по телефону: есть ли цифры запроса q в номере (phone — номер или phoneDigits).
// Меньше 3 цифр — не ищем; «8…» в начале запроса равно «7…».
export function phoneMatch(phone, q) {
  const d = digits(q);
  if (d.length < 3) return false;
  const pd = digits(phone);
  return pd.includes(d) || (d[0] === '8' && pd.includes('7' + d.slice(1)));
}
