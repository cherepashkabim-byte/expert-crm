/// <reference path="../pb_data/types.d.ts" />
// Статика pb_public: Cache-Control: no-cache — браузер перепроверяет файлы (304 по Last-Modified)
// и после обновления кода не держит старые js-модули. /api/ и админку /_/ не трогаем.

routerUse((e) => {
  const path = e.request.url.path;
  if (!path.startsWith('/api/') && path !== '/_' && !path.startsWith('/_/')) {
    e.response.header().set('Cache-Control', 'no-cache');
  }
  return e.next();
});
