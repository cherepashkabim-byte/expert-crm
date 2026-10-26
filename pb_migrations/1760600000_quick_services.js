/// <reference path="../pb_data/types.d.ts" />
// Список услуг «Быстрого заказа» (settings.quickServices — json-массив строк). Правит владелец:
// в «Настройках» или кнопкой «+ В список» прямо в «Быстром заказе». Пустой — фронт берёт стандартный (order-quick.QUICK_SERVICES).

migrate((app) => {
  const settings = app.findCollectionByNameOrId('settings');
  if (!settings.fields.getByName('quickServices')) settings.fields.add(new JSONField({ name: 'quickServices', maxSize: 20000 }));
  app.save(settings);
}, (app) => {
  const settings = app.findCollectionByNameOrId('settings');
  settings.fields.removeByName('quickServices');
  app.save(settings);
});
