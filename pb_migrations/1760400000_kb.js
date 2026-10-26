/// <reference path="../pb_data/types.d.ts" />
// База знаний: kb_articles — статьи по моделям устройств и общие (Markdown в body, формат — pb_public/kb/FORMAT.md).
// Читают все вошедшие; создаёт, меняет и удаляет только владелец. slug уникален: по нему стартовые статьи
// загружаются без дублей и без перезаписи правок владельца.

const AUTH = '@request.auth.id != ""';
const OWNER = '@request.auth.role = "owner"';

migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  const c = new Collection({
    type: 'base', name: 'kb_articles',
    listRule: AUTH, viewRule: AUTH, createRule: OWNER, updateRule: OWNER, deleteRule: OWNER,
    fields: [
      { name: 'slug', type: 'text', required: true, pattern: '^[a-z0-9-]+$', max: 100 },
      { name: 'title', type: 'text', required: true, max: 200 },
      { name: 'category', type: 'text', max: 60 },
      { name: 'brand', type: 'text', max: 60 },
      { name: 'deviceType', type: 'text', max: 60 },
      { name: 'models', type: 'json', maxSize: 100000 },
      { name: 'body', type: 'text', max: 200000 },
      { name: 'sources', type: 'json', maxSize: 100000 },
      { name: 'checked', type: 'text', max: 10 },
      { name: 'updatedBy', type: 'relation', collectionId: users.id, maxSelect: 1 },
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_kb_articles_slug ON kb_articles (slug)'],
  });
  app.save(c);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId('kb_articles')); } catch (_) {}
});
