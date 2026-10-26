/// <reference path="../pb_data/types.d.ts" />
// Штрихкод у запчасти и товара (parts.barcode, products.barcode) и «быстрый» заказ (orders.quick).
// Штрихкод не уникален: одна и та же позиция лежит на разных точках; индекс — только для поиска сканом.

migrate((app) => {
  for (const name of ['parts', 'products']) {
    const c = app.findCollectionByNameOrId(name);
    if (!c.fields.getByName('barcode')) c.fields.add(new TextField({ name: 'barcode', max: 64 }));
    c.addIndex('idx_' + name + '_barcode', false, 'barcode', '');
    app.save(c);
  }
  const orders = app.findCollectionByNameOrId('orders');
  if (!orders.fields.getByName('quick')) orders.fields.add(new BoolField({ name: 'quick' }));
  app.save(orders);
}, (app) => {
  for (const name of ['parts', 'products']) {
    const c = app.findCollectionByNameOrId(name);
    c.removeIndex('idx_' + name + '_barcode');
    c.fields.removeByName('barcode');
    app.save(c);
  }
  const orders = app.findCollectionByNameOrId('orders');
  orders.fields.removeByName('quick');
  app.save(orders);
});
