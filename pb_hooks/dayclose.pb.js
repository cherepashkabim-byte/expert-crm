/// <reference path="../pb_data/types.d.ts" />
// Закрытие дня для мастеров (уровень запроса — нужна роль автора; правила — lib.assertDayOpen):
// после 00:00 по Кемерово мастер не меняет заказ, выданный в прошлые дни, его запчасти, а также оплаты, продажи,
// кассу и штрафы с датой прошлого дня. Новые оплаты сегодняшним числом (доплата долга по старому заказу) — можно.

onRecordUpdateRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const o = e.record.original();
  if (o.getString('status') === 'issued') lib.assertDayOpen(e, [o.getString('issuedAt')]);
  e.next();
}, 'orders');

onRecordDeleteRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  if (e.record.getString('status') === 'issued') lib.assertDayOpen(e, [e.record.getString('issuedAt')]);
  e.next();
}, 'orders');

onRecordCreateRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  lib.assertDayOpen(e, [lib.issuedDay(e.app, e.record.getString('order'))]);
  e.next();
}, 'order_parts');

onRecordUpdateRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  lib.assertDayOpen(e, [lib.issuedDay(e.app, e.record.original().getString('order')), lib.issuedDay(e.app, e.record.getString('order'))]);
  e.next();
}, 'order_parts');

onRecordDeleteRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  lib.assertDayOpen(e, [lib.issuedDay(e.app, e.record.getString('order'))]);
  e.next();
}, 'order_parts');

// Оплаты и продажи — по полю at, касса и штрафы — по date (пустая дата при создании = «сейчас»).
onRecordCreateRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const name = e.record.collection().name;
  lib.assertDayOpen(e, [e.record.getString(name === 'payments' || name === 'sales' ? 'at' : 'date')]);
  e.next();
}, 'payments', 'sales', 'cash_ops', 'fines');

onRecordUpdateRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const name = e.record.collection().name;
  const f = name === 'payments' || name === 'sales' ? 'at' : 'date';
  lib.assertDayOpen(e, [e.record.original().getString(f), e.record.getString(f)]);
  e.next();
}, 'payments', 'sales', 'cash_ops', 'fines');

onRecordDeleteRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const name = e.record.collection().name;
  lib.assertDayOpen(e, [e.record.getString(name === 'payments' || name === 'sales' ? 'at' : 'date')]);
  e.next();
}, 'payments', 'sales', 'cash_ops', 'fines');
