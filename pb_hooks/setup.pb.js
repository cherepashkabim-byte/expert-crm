/// <reference path="../pb_data/types.d.ts" />
// Первый запуск: создание владельца, пока в users нет ни одной записи.

routerAdd('GET', '/api/expert/setup', (e) => {
  const n = e.app.countRecords('users');
  return e.json(200, { needed: n === 0 });
});

routerAdd('POST', '/api/expert/setup', (e) => {
  if (e.app.countRecords('users') > 0) {
    throw new ForbiddenError('Владелец уже создан. Войдите по почте и паролю.');
  }
  const body = e.requestInfo().body || {};
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  if (!name) throw new BadRequestError('Укажите имя');
  if (!email) throw new BadRequestError('Укажите почту');
  if (password.length < 8) throw new BadRequestError('Пароль должен быть не короче 8 символов');

  const rec = new Record(e.app.findCollectionByNameOrId('users'));
  rec.set('name', name);
  rec.set('email', email);
  rec.set('role', 'owner');
  rec.set('active', true);
  rec.set('verified', true);
  rec.setPassword(password);
  try {
    e.app.save(rec);
  } catch (err) {
    throw new BadRequestError('Не удалось создать владельца: проверьте почту', { error: String(err) });
  }
  return e.json(200, { id: rec.id, email, name });
});
