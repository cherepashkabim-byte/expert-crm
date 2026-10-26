/// <reference path="../pb_data/types.d.ts" />
// График смен: shifts(day 'ГГГГ-ММ-ДД', user, point, note). Видят все, меняет только владелец.
// Один сотрудник — одна смена в день (уникальный индекс user+day). День — строкой: без сдвигов часовых поясов.

const AUTH = '@request.auth.id != ""';
const OWNER = '@request.auth.role = "owner"';

migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  const points = app.findCollectionByNameOrId('points');
  const c = new Collection({
    type: 'base', name: 'shifts',
    listRule: AUTH, viewRule: AUTH, createRule: OWNER, updateRule: OWNER, deleteRule: OWNER,
    fields: [
      { name: 'day', type: 'text', required: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$', max: 10 },
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'point', type: 'relation', collectionId: points.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'note', type: 'text', max: 200 },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_shifts_user_day ON shifts (user, day)', 'CREATE INDEX idx_shifts_day ON shifts (day)'],
  });
  app.save(c);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId('shifts')); } catch (_) {}
});
