/// <reference path="../pb_data/types.d.ts" />
// Марка устройства в заказе (orders.brand): «Марка» + «Модель», как в LiveSklad.
// Старые заказы не трогаем — в интерфейсе марка для них угадывается по модели (order-hints.normDevice).

migrate((app) => {
  const orders = app.findCollectionByNameOrId('orders');
  if (!orders.fields.getByName('brand')) orders.fields.add(new TextField({ name: 'brand', max: 100 }));
  app.save(orders);
}, (app) => {
  const orders = app.findCollectionByNameOrId('orders');
  orders.fields.removeByName('brand');
  app.save(orders);
});
