/// <reference path="../pb_data/types.d.ts" />
// Заказы: номер, статус по умолчанию, дата приёма/выдачи, журнал изменений, СМС о готовности.

// Модельный уровень — срабатывает и для API, и для импорта суперпользователем.
onRecordCreate((e) => {
  const r = e.record;
  if (!(r.getFloat('num') > 0)) {
    const last = e.app.findRecordsByFilter('orders', 'num > 0', '-num', 1, 0);
    r.set('num', last.length ? last[0].getInt('num') + 1 : 1);
  }
  if (!r.getString('status')) r.set('status', 'new');
  if (r.getDateTime('acceptedAt').isZero()) r.set('acceptedAt', new DateTime());
  if (r.getString('status') === 'issued' && r.getDateTime('issuedAt').isZero()) r.set('issuedAt', new DateTime());
  if (r.getString('status') === 'ready' && r.getDateTime('readyAt').isZero()) r.set('readyAt', new DateTime());
  e.next();
}, 'orders');

onRecordUpdate((e) => {
  const r = e.record;
  const was = r.original().getString('status');
  const now = r.getString('status');
  if (now === 'issued' && was !== 'issued' && r.getDateTime('issuedAt').isZero()) r.set('issuedAt', new DateTime());
  if (was === 'issued' && now !== 'issued') r.set('issuedAt', '');
  if (now === 'ready' && was !== 'ready') r.set('readyAt', new DateTime());
  if (was === 'ready' && now !== 'ready') r.set('readyAt', '');
  e.next();
}, 'orders');

// Уровень запроса — знаем, кто сделал изменение.
onRecordCreateRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  e.next();
  try { lib.writeLog(e.app, e.record.id, lib.authUserId(e), 'created', '', '№ ' + e.record.getInt('num')); } catch (err) { e.app.logger().error('order_log', 'error', String(err)); }
}, 'orders');

onRecordUpdateRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const before = lib.snapshot(e.record.original());
  // Фото удаляет только владелец (суперпользователь — тоже).
  const kept = e.record.getStringSlice('photos');
  const removed = e.record.original().getStringSlice('photos').filter((f) => kept.indexOf(f) < 0);
  if (removed.length && e.auth && lib.authUserId(e) && lib.authRole(e) !== 'owner') {
    throw new ForbiddenError('Удалить фото может только владелец');
  }
  e.next();
  const userId = lib.authUserId(e);
  try { lib.logDiff(e.app, e.record, before, userId); } catch (err) { e.app.logger().error('order_log', 'error', String(err)); }
  if (before.status !== 'ready' && e.record.getString('status') === 'ready' && e.record.getBool('notifySms')) {
    lib.notifyReady(e.app, e.record, userId);
  }
}, 'orders');
