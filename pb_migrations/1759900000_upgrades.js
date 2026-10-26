/// <reference path="../pb_data/types.d.ts" />
// Доработки (октябрь): фото и «готов с» у заказов, гарантия, склад по точкам, перемещения,
// заявки с сайта, закрытие месяца, settings.forgotDays. Текущие остатки — на «пр-т Притомский 31к2».

const AUTH = '@request.auth.id != ""';
const OWNER = '@request.auth.role = "owner"';
const HOME_POINT = 'пр-т Притомский 31к2';

migrate((app) => {
  const STAMPS = [
    { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
    { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
  ];
  const users = app.findCollectionByNameOrId('users');
  const points = app.findCollectionByNameOrId('points');
  const orders = app.findCollectionByNameOrId('orders');
  const R = (name, collectionId, opts) => Object.assign({ name, type: 'relation', collectionId, maxSelect: 1, cascadeDelete: false }, opts || {});
  const make = (name, fields, rules, indexes) => {
    const c = new Collection(Object.assign({
      type: 'base', name,
      listRule: AUTH, viewRule: AUTH, createRule: AUTH, updateRule: AUTH, deleteRule: OWNER,
      fields: fields.concat(STAMPS), indexes: indexes || [],
    }, rules || {}));
    app.save(c);
    return c;
  };

  // --- заказы: фото, «готов с», гарантия ---
  orders.fields.add(new FileField({
    name: 'photos', maxSelect: 6, maxSize: 10 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
    thumbs: ['100x100', '600x0'],
  }));
  orders.fields.add(new DateField({ name: 'readyAt' }));
  orders.fields.add(new RelationField({ name: 'warrantyOf', collectionId: orders.id, maxSelect: 1, cascadeDelete: false }));
  app.save(orders);
  // старые «Готов»: готов с последнего изменения
  app.db().newQuery("UPDATE orders SET readyAt = updated WHERE status = 'ready' AND (readyAt = '' OR readyAt IS NULL)").execute();

  // --- склад по точкам: все текущие позиции — на Притомский ---
  // Без Притомского переносить остатки некуда — миграция падает и откатывается целиком.
  let home;
  try { home = app.findFirstRecordByData('points', 'name', HOME_POINT); } catch (_) {
    throw new Error('Миграция доработок: не найдена точка «' + HOME_POINT + '» — некуда записать текущие остатки склада. Верните точке это название и запустите снова.');
  }
  for (const name of ['parts', 'products']) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.add(new RelationField({ name: 'point', collectionId: points.id, maxSelect: 1, required: true, cascadeDelete: false }));
    app.save(c);
    app.db().newQuery(`UPDATE ${name} SET point = {:p} WHERE point = '' OR point IS NULL`).bind({ p: home.id }).execute();
  }

  // --- настройки ---
  const settings = app.findCollectionByNameOrId('settings');
  settings.fields.add(new NumberField({ name: 'forgotDays' }));
  app.save(settings);
  app.db().newQuery('UPDATE settings SET forgotDays = 7 WHERE forgotDays IS NULL OR forgotDays = 0').execute();

  // --- заявки с сайта: создаются только публичным маршрутом /api/expert/lead ---
  make('leads', [
    { name: 'name', type: 'text', max: 200 }, { name: 'phone', type: 'text', max: 50 },
    { name: 'device', type: 'text', max: 500 }, { name: 'problem', type: 'text', max: 5000 },
    R('point', points.id),
    { name: 'status', type: 'select', maxSelect: 1, values: ['new', 'done', 'rejected'] },
    R('order', orders.id), { name: 'ip', type: 'text', max: 100 }, { name: 'at', type: 'date' },
  ], { createRule: null }, ['CREATE INDEX idx_leads_ip_at ON leads (ip, at)']);

  // --- перемещения между точками: пишет только маршрут /api/expert/transfer ---
  make('stock_moves', [
    { name: 'kind', type: 'select', maxSelect: 1, values: ['part', 'product'] },
    { name: 'item', type: 'text', max: 50 }, { name: 'name', type: 'text', max: 500 },
    R('fromPoint', points.id), R('toPoint', points.id), { name: 'qty', type: 'number' },
    R('by', users.id), { name: 'at', type: 'date' },
  ], { createRule: null, updateRule: null, deleteRule: null });

  // --- закрытые месяцы: закрывает (создаёт) и открывает (удаляет) только владелец ---
  make('month_closes', [
    { name: 'month', type: 'text', max: 7, required: true }, { name: 'snapshot', type: 'json', maxSize: 20 * 1024 * 1024 },
    R('closedBy', users.id), { name: 'at', type: 'date' },
    { name: 'from', type: 'date' }, { name: 'to', type: 'date' },
  ], { createRule: OWNER, updateRule: null, deleteRule: OWNER }, ['CREATE UNIQUE INDEX idx_month_closes_month ON month_closes (month)']);
}, (app) => {
  // Откат удаляет новые коллекции и поля ВМЕСТЕ С ДАННЫМИ: заявки, историю перемещений, закрытые месяцы,
  // фото заказов, readyAt/warrantyOf, привязку склада к точкам и forgotDays. Вернуть их можно только из бэкапа.
  for (const name of ['month_closes', 'stock_moves', 'leads']) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const drop = (col, fields) => {
    const c = app.findCollectionByNameOrId(col);
    for (const f of fields) c.fields.removeByName(f);
    app.save(c);
  };
  drop('orders', ['photos', 'readyAt', 'warrantyOf']);
  drop('parts', ['point']);
  drop('products', ['point']);
  drop('settings', ['forgotDays']);
});
