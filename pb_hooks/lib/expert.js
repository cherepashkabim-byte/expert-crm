/// <reference path="../../pb_data/types.d.ts" />
// Общие функции хуков. Подключается внутри обработчиков: require(`${__hooks}/lib/expert.js`).

const SKIP = { id: 1, created: 1, updated: 1 };

// Кто сделал запрос: id сотрудника или '' (суперпользователь / без входа).
function authUserId(e) {
  const a = e.auth;
  if (!a) return '';
  try { return a.collection().name === 'users' ? a.id : ''; } catch (_) { return ''; }
}

function snapshot(record) {
  const out = {};
  for (const f of record.collection().fields) {
    if (SKIP[f.name] || f.type === 'password') continue;
    out[f.name] = record.getString(f.name);
  }
  return out;
}

function writeLog(app, orderId, userId, field, oldV, newV) {
  const r = new Record(app.findCollectionByNameOrId('order_log'));
  r.set('order', orderId);
  r.set('user', userId || '');
  r.set('field', field);
  r.set('old', oldV == null ? '' : String(oldV));
  r.set('new', newV == null ? '' : String(newV));
  r.set('at', new DateTime());
  app.save(r);
}

// Пишет по записи на каждое изменённое поле.
function logDiff(app, record, before, userId) {
  const after = snapshot(record);
  for (const k in after) {
    if (before[k] !== after[k]) writeLog(app, record.id, userId, k, before[k], after[k]);
  }
}

// Цифры телефона: 8/7/+7 в начале считаются одинаковыми → всегда 7XXXXXXXXXX.
function phoneDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d;
}

// Марка + модель без повтора марки. Близнец deviceName() из pb_public/js/views/order-hints.js
// (хуки не импортируют ES-модули фронта): те же нормализация и условие; марку не угадывает.
function deviceName(brand, model) {
  const low = (s) => String(s || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  const b = String(brand || '').trim();
  const m = String(model || '').trim();
  if (!b) return m;
  if (!m) return b;
  return low(m).indexOf(low(b)) === 0 ? m : b + ' ' + m;
}

// Телефон клиента заказа и реквизиты точки для СМС.
function smsContext(app, order) {
  // устройство в тексте: марка + модель без повтора («Apple» + «iPhone 13»; «Xiaomi» + «Xiaomi 13T» → «Xiaomi 13T»).
  // Близнец deviceName() из pb_public/js/views/order-hints.js — условие склейки должно совпадать с ним.
  const device = deviceName(order.getString('brand'), order.getString('model'));
  const c = { phone: '', model: device, address: '', pointPhone: '' };
  try { c.phone = phoneDigits(app.findRecordById('clients', order.getString('client')).getString('phone')); } catch (_) {}
  try {
    const p = app.findRecordById('points', order.getString('point'));
    c.address = p.getString('address') || p.getString('name');
    c.pointPhone = p.getString('phone');
  } catch (_) {}
  c.sign = ['Эксперт', c.address, c.pointPhone].filter(Boolean).join(', ');
  return c;
}

// Отправка через sms.ru. Никогда не бросает исключений; возвращает текст результата для журнала.
function sendSms(apiId, phone, text) {
  try {
    if (!phone) return 'СМС не отправлено: у клиента нет телефона';
    const res = $http.send({
      method: 'GET', timeout: 15,
      url: 'https://sms.ru/sms/send?api_id=' + encodeURIComponent(apiId) + '&to=' + phone + '&msg=' + encodeURIComponent(text) + '&json=1',
    });
    const j = res.json || {};
    const sms = (j.sms && j.sms[phone]) || {};
    if (res.statusCode === 200 && j.status === 'OK' && sms.status === 'OK') return 'СМС отправлено на ' + phone + ': ' + text;
    return 'СМС не отправлено: ошибка сервиса (' + (sms.status_text || j.status_text || ('HTTP ' + res.statusCode)) + ')';
  } catch (err) {
    return 'СМС не отправлено: ошибка сервиса (' + String(err) + ')';
  }
}

// СМС о готовности. Никогда не бросает исключений; результат пишет в order_log (field = sms).
function notifyReady(app, order, userId) {
  let result;
  try {
    const apiId = $os.getenv('SMS_RU_API_ID');
    if (!apiId) {
      result = 'СМС не отправлено: СМС-сервис не подключён';
    } else {
      const c = smsContext(app, order);
      const sum = order.getFloat('price') || order.getFloat('approxPrice');
      const text = ['Здравствуйте! Ваше устройство' + (c.model ? ' ' + c.model : '') + ' готово.',
        sum ? 'К оплате ' + sum + ' ₽.' : '', c.sign].filter(Boolean).join(' ');
      result = sendSms(apiId, c.phone, text);
    }
  } catch (err) {
    result = 'СМС не отправлено: ошибка сервиса (' + String(err) + ')';
  }
  try { writeLog(app, order.id, userId, 'sms', '', result); } catch (_) {}
}

// «Напомнить клиенту» о готовом устройстве: СМС, если sms.ru подключён, иначе отметка «позвонили».
// Результат — в order_log (field = remind) с автором; возвращает текст записи.
function notifyRemind(app, order, userId) {
  let result;
  try {
    const apiId = $os.getenv('SMS_RU_API_ID');
    if (!apiId) {
      result = 'Напоминание: позвонили клиенту';
    } else {
      const c = smsContext(app, order);
      const text = ['Здравствуйте! Напоминаем: ваше устройство' + (c.model ? ' ' + c.model : '') + ' готово и ждёт вас.', c.sign]
        .filter(Boolean).join(' ');
      result = sendSms(apiId, c.phone, text);
    }
  } catch (err) {
    result = 'СМС не отправлено: ошибка сервиса (' + String(err) + ')';
  }
  writeLog(app, order.id, userId, 'remind', '', result);
  return result;
}

// Склад запчастей: изменить остаток на delta (уход в минус разрешён).
function addStock(app, collection, id, delta) {
  if (!id || !delta) return;
  const r = app.findRecordById(collection, id);
  r.set('stock', r.getFloat('stock') + delta);
  app.save(r);
}

// Роль вошедшего сотрудника: 'owner' | 'master' | '' (суперпользователь / без входа).
function authRole(e) {
  const a = e.auth;
  if (!a) return '';
  try { return a.collection().name === 'users' ? a.getString('role') : ''; } catch (_) { return ''; }
}

// Телефон клиента — то же правило, что fmt.phoneValid: только цифры, пробелы, скобки, дефисы, «+»; ровно 11 цифр, первая 7 или 8.
const PHONE_ERR = 'Проверьте номер: нужно 11 цифр, например 8 900 123-45-67';
function phoneValid(s) {
  const str = String(s == null ? '' : s);
  if (!/^[\d\s()+-]*$/.test(str)) return false;
  return /^[78]\d{10}$/.test(str.replace(/\D/g, ''));
}

// Точка по умолчанию для новых запчастей/товаров: первая по sort (пр-т Притомский 31к2).
function defaultPointId(app) {
  const r = app.findRecordsByFilter('points', '', 'sort', 1, 0);
  return r.length ? r[0].id : '';
}

// Запчасть в заказе должна быть со склада точки заказа (импорт с legacyKey не проверяется).
function checkPartPoint(app, r) {
  if (r.getString('legacyKey') || !r.getString('part')) return;
  const part = app.findRecordById('parts', r.getString('part'));
  const order = app.findRecordById('orders', r.getString('order'));
  const pp = part.getString('point'), op = order.getString('point');
  if (pp && op && pp !== op) throw new BadRequestError('Запчасти нет на этой точке');
}

// ---------- закрытые месяцы ----------
// Месяц считается по времени Кемерово (UTC+7): границы 'ГГГГ-ММ' в UTC для полей date.
const TZ_HOURS = 7;
const MONTH_CLOSED = 'Месяц закрыт — изменение запрещено';
const pbDate = (ms) => new Date(ms).toISOString().replace('T', ' ');
function monthBounds(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  const from = Date.UTC(+m[1], +m[2] - 1, 1) - TZ_HOURS * 3600000;
  const to = Date.UTC(+m[1], +m[2], 1) - TZ_HOURS * 3600000;
  return { from: pbDate(from), to: pbDate(to), toMs: to };
}

// Закрыт ли месяц, в который попадает дата (строка поля date PocketBase). Пустая дата — не закрыт.
function isClosedDate(app, d) {
  if (!d) return false;
  return app.findRecordsByFilter('month_closes', 'from <= {:d} && to > {:d}', '', 1, 0, { d: String(d) }).length > 0;
}

// Бросает 400, если хоть одна из дат лежит в закрытом месяце.
function assertOpen(app, dates) {
  for (const d of dates) if (isClosedDate(app, d)) throw new BadRequestError(MONTH_CLOSED);
}

// ---------- закрытие дня ----------
// После 00:00 по Кемерово мастер не меняет выданные заказы и деньги прошлых дней; владелец и суперпользователь — всё.
const DAY_CLOSED = 'День закрыт: выданные заказы и деньги прошлых дней может менять только владелец';
function dayStart(ms) {
  const DAY = 86400000, tz = TZ_HOURS * 3600000;
  return pbDate(Math.floor(((ms == null ? Date.now() : ms) + tz) / DAY) * DAY - tz);
}
// Бросает 400 мастеру, если хоть одна дата (строка поля date) раньше начала сегодняшнего дня. Пустая дата — сегодня.
function assertDayOpen(e, dates) {
  if (!e.auth || e.hasSuperuserAuth() || authRole(e) === 'owner') return;
  const start = dayStart();
  // в закрытом месяце — его сообщение (точнее, и владелец там тоже ничего не меняет)
  for (const d of dates) if (d && String(d) < start) throw new BadRequestError(isClosedDate(e.app, d) ? MONTH_CLOSED : DAY_CLOSED);
}
// Дата выдачи заказа, если он выдан (для проверки закрытого дня), иначе ''.
function issuedDay(app, orderId) {
  try {
    const o = app.findRecordById('orders', orderId);
    return o.getString('status') === 'issued' ? o.getString('issuedAt') : '';
  } catch (_) { return ''; }
}

// Денежные поля заказа: их нельзя менять у заказа, выданного в закрытом месяце.
const ORDER_MONEY = ['price', 'courier', 'repairedBy', 'repairedName', 'status', 'issuedAt', 'masterPayManual', 'point', 'warrantyOf'];

// ---------- журнал оплат и запчастей заказа ----------
// Деньги как fmt.money на фронте: «1 000 ₽».
function moneyText(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}

// Текст записи журнала: оплата «1 000 ₽ · Нал», запчасть «Стекло × 2 · 1 500 ₽» (qty × cost).
function orderLogText(kind, r) {
  if (kind === 'payment') return [moneyText(r.getFloat('amount')), r.getString('method')].filter(Boolean).join(' · ');
  const qty = r.getFloat('qty');
  return (r.getString('name') || 'Запчасть') + ' × ' + qty + ' · ' + moneyText(qty * r.getFloat('cost'));
}

// Запись о добавлении (field = kind, new = text) или удалении (field = kind + '-', old = text).
// Удалённый заказ пропускается; ошибки только логируются.
function logOrderItem(e, kind, deleted, text, orderId) {
  try {
    e.app.findRecordById('orders', orderId);
  } catch (_) { return; }
  try {
    writeLog(e.app, orderId, authUserId(e), deleted ? kind + '-' : kind, deleted ? text : '', deleted ? '' : text);
  } catch (err) {
    e.app.logger().error('order_log', 'error', String(err));
  }
}

// Точка заявки с сайта: id или текст («Советский 24», «пр-т Шахтёров, 83») — ищется по названию и адресу точки.
// Не нашлась или подходит несколько — '' (заявка общая, её разбирает владелец).
function findLeadPoint(app, text) {
  const s = String(text || '').trim();
  if (!s) return '';
  try { return app.findRecordById('points', s).id; } catch (_) { /* не id — ищем по тексту */ }
  const key = (v) => String(v || '').toLowerCase().replace(/ё/g, 'е').replace(/корпус/g, 'к')
    .replace(/проспект|пр-т|пр\.|улица|ул\./g, ' ').replace(/[^a-zа-я0-9]+/g, '');
  const q = key(s);
  if (q.length < 3) return '';
  const hits = app.findAllRecords('points').filter((p) => [p.getString('name'), p.getString('address')]
    .some((v) => { const k = key(v); return k && (k.includes(q) || q.includes(k)); }));
  return hits.length === 1 ? hits[0].id : '';
}

module.exports = { moneyText, orderLogText, logOrderItem, authUserId, authRole, deviceName, snapshot, writeLog, logDiff, phoneDigits, phoneValid, PHONE_ERR, notifyReady, notifyRemind, addStock,
  defaultPointId, checkPartPoint, monthBounds, isClosedDate, assertOpen, MONTH_CLOSED, ORDER_MONEY, findLeadPoint,
  DAY_CLOSED, dayStart, assertDayOpen, issuedDay };
