/// <reference path="../pb_data/types.d.ts" />
// Склад запчастей (order_parts), товары и продажи (sales), цифры телефона клиента, даты по умолчанию.

// --- клиенты: phoneDigits считается сервером из phone ---
onRecordCreate((e) => {
  e.record.set('phoneDigits', require(`${__hooks}/lib/expert.js`).phoneDigits(e.record.getString('phone')));
  e.next();
}, 'clients');
onRecordUpdate((e) => {
  e.record.set('phoneDigits', require(`${__hooks}/lib/expert.js`).phoneDigits(e.record.getString('phone')));
  e.next();
}, 'clients');

// --- запчасти и товары принадлежат точке; без точки — на первую (пр-т Притомский 31к2) ---
onRecordCreate((e) => {
  if (!e.record.getString('point')) e.record.set('point', require(`${__hooks}/lib/expert.js`).defaultPointId(e.app));
  e.next();
}, 'parts', 'products');

// --- запчасти в заказе: списание/возврат (кроме импортированных с legacyKey) ---
onRecordCreate((e) => {
  require(`${__hooks}/lib/expert.js`).checkPartPoint(e.app, e.record);
  e.next();
  if (e.record.getString('legacyKey')) return;
  require(`${__hooks}/lib/expert.js`).addStock(e.app, 'parts', e.record.getString('part'), -e.record.getFloat('qty'));
}, 'order_parts');

onRecordUpdate((e) => {
  const o = e.record.original();
  const oldPart = o.getString('part'), oldQty = o.getFloat('qty'), oldLegacy = !!o.getString('legacyKey');
  if (e.record.getString('part') !== oldPart) require(`${__hooks}/lib/expert.js`).checkPartPoint(e.app, e.record);
  e.next();
  const lib = require(`${__hooks}/lib/expert.js`);
  if (!oldLegacy) lib.addStock(e.app, 'parts', oldPart, oldQty);
  if (!e.record.getString('legacyKey')) lib.addStock(e.app, 'parts', e.record.getString('part'), -e.record.getFloat('qty'));
}, 'order_parts');

onRecordDelete((e) => {
  const part = e.record.getString('part'), qty = e.record.getFloat('qty'), legacy = !!e.record.getString('legacyKey');
  e.next();
  if (legacy) return;
  try { require(`${__hooks}/lib/expert.js`).addStock(e.app, 'parts', part, qty); } catch (_) { /* запчасть уже удалена */ }
}, 'order_parts');

// --- продажи: запрет сверх остатка, фиксация закупки, списание/возврат ---
onRecordCreate((e) => {
  const r = e.record;
  const qty = r.getFloat('qty');
  const pid = r.getString('product');
  if (!r.getString('point')) throw new BadRequestError('Укажите точку продажи');
  if (pid) {
    const p = e.app.findRecordById('products', pid);
    if (p.getString('point') && r.getString('point') && p.getString('point') !== r.getString('point')) {
      throw new BadRequestError('Товара нет на этой точке');
    }
    const stock = p.getFloat('stock');
    if (stock < qty) throw new BadRequestError('Недостаточно товара на складе: осталось ' + stock);
    if (!(r.getFloat('cost') > 0)) r.set('cost', p.getFloat('cost'));
  }
  if (r.getDateTime('at').isZero()) r.set('at', new DateTime());
  e.next();
  require(`${__hooks}/lib/expert.js`).addStock(e.app, 'products', pid, -qty);
}, 'sales');

onRecordUpdate((e) => {
  const o = e.record.original();
  const oldP = o.getString('product'), oldQty = o.getFloat('qty');
  e.next();
  const lib = require(`${__hooks}/lib/expert.js`);
  lib.addStock(e.app, 'products', oldP, oldQty);
  lib.addStock(e.app, 'products', e.record.getString('product'), -e.record.getFloat('qty'));
}, 'sales');

onRecordDelete((e) => {
  const pid = e.record.getString('product'), qty = e.record.getFloat('qty');
  e.next();
  try { require(`${__hooks}/lib/expert.js`).addStock(e.app, 'products', pid, qty); } catch (_) { /* товар уже удалён */ }
}, 'sales');

// --- даты «сейчас», если не переданы ---
onRecordCreate((e) => {
  if (e.record.getDateTime('at').isZero()) e.record.set('at', new DateTime());
  e.next();
}, 'payments', 'visits');
