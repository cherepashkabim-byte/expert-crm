/// <reference path="../pb_data/types.d.ts" />
// База знаний: kb_articles.seedHash — хеш содержимого стартовой статьи на момент загрузки (kb-lib.contentHash).
// Если текущее содержимое статьи совпадает с seedHash — владелец её не правил, и кнопка «Загрузить / обновить
// стартовые статьи» может заменить её новой версией; иначе статья считается правленой и не трогается.

migrate((app) => {
  const kb = app.findCollectionByNameOrId('kb_articles');
  if (!kb.fields.getByName('seedHash')) kb.fields.add(new TextField({ name: 'seedHash', max: 64 }));
  app.save(kb);
}, (app) => {
  const kb = app.findCollectionByNameOrId('kb_articles');
  kb.fields.removeByName('seedHash');
  app.save(kb);
});
