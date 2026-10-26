/// <reference path="../pb_data/types.d.ts" />
// Журнал заказа (order_log): оплаты и запчасти (кто добавил/удалил), комментарии сотрудников.
// field: payment / payment- («1 000 ₽ · Нал»), part / part- («Стекло × 2 · 1 500 ₽»), comment (текст).
// Уровень запроса — знаем автора. Импорт (legacyId / legacyKey) журнал не пишет. Каскадное удаление
// заказа сюда не попадает (это модельный уровень), а журнал удаляется вместе с заказом.

onRecordCreateRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  e.next();
  const kind = e.record.collection().name === 'payments' ? 'payment' : 'part';
  if (e.record.getString(kind === 'payment' ? 'legacyId' : 'legacyKey')) return;
  lib.logOrderItem(e, kind, false, lib.orderLogText(kind, e.record), e.record.getString('order'));
}, 'payments', 'order_parts');

onRecordDeleteRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const kind = e.record.collection().name === 'payments' ? 'payment' : 'part';
  const legacy = !!e.record.getString(kind === 'payment' ? 'legacyId' : 'legacyKey');
  const text = lib.orderLogText(kind, e.record), orderId = e.record.getString('order');
  e.next();
  if (legacy) return;
  lib.logOrderItem(e, kind, true, text, orderId);
}, 'payments', 'order_parts');

// --- POST /api/expert/comment {orderId, text} → {ok:true}: комментарий в журнал (field = comment) ---
// Закрытый месяц комментарии не блокирует: журнал — не деньги.
routerAdd('POST', '/api/expert/comment', (e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const body = e.requestInfo().body || {};
  const text = String(body.text == null ? '' : body.text).trim();
  if (!text) throw new BadRequestError('Напишите текст комментария');
  if (text.length > 2000) throw new BadRequestError('Комментарий слишком длинный: не больше 2000 знаков');
  let order;
  try { order = e.app.findRecordById('orders', String(body.orderId || '')); } catch (_) { throw new NotFoundError('Заказ не найден'); }
  lib.writeLog(e.app, order.id, lib.authUserId(e), 'comment', '', text);
  return e.json(200, { ok: true });
}, $apis.requireAuth('users'));
