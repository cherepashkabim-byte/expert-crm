/// <reference path="../pb_data/types.d.ts" />
// Доработки: перемещение между точками, заявки с сайта, закрытие месяца и блокировка денег закрытого месяца.

// --- POST /api/expert/transfer {kind:'part'|'product', id, toPoint, qty} — только вошедшим сотрудникам ---
routerAdd('POST', '/api/expert/transfer', (e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const body = e.requestInfo().body || {};
  const kind = String(body.kind || '');
  const col = kind === 'part' ? 'parts' : kind === 'product' ? 'products' : '';
  if (!col) throw new BadRequestError('Неизвестный вид позиции');
  const qty = Number(body.qty);
  if (!Number.isInteger(qty) || qty <= 0) throw new BadRequestError('Укажите количество — целое число больше нуля');
  const toPoint = String(body.toPoint || '');
  const userId = lib.authUserId(e);
  let result;
  e.app.runInTransaction((tx) => {
    let src;
    try { src = tx.findRecordById(col, String(body.id || '')); } catch (_) { throw new BadRequestError('Позиция не найдена'); }
    try { tx.findRecordById('points', toPoint); } catch (_) { throw new BadRequestError('Выберите точку-получателя'); }
    const fromPoint = src.getString('point');
    if (fromPoint === toPoint) throw new BadRequestError('Позиция уже на этой точке — выберите другую');
    const stock = src.getFloat('stock');
    if (qty > stock) throw new BadRequestError('Нельзя переместить больше, чем есть: ' + Math.max(0, stock) + ' шт.');

    // «та же» позиция на получателе: модель+название (запчасти) или название (товары), без учёта регистра
    const norm = (s) => String(s || '').trim().toLowerCase();
    const same = (r) => norm(r.getString('name')) === norm(src.getString('name'))
      && (col !== 'parts' || norm(r.getString('model')) === norm(src.getString('model')));
    let dst = tx.findRecordsByFilter(col, 'point = {:p}', '', 0, 0, { p: toPoint }).filter(same)[0];
    if (dst) {
      dst.set('stock', dst.getFloat('stock') + qty);
    } else {
      dst = new Record(src.collection());
      const copy = col === 'parts' ? ['model', 'name', 'category', 'supplier', 'cost', 'comment'] : ['name', 'category', 'cost', 'price'];
      for (const f of copy) dst.set(f, src.get(f));
      dst.set('point', toPoint);
      dst.set('stock', qty);
    }
    src.set('stock', stock - qty);
    tx.save(src);
    tx.save(dst);

    const move = new Record(tx.findCollectionByNameOrId('stock_moves'));
    const name = col === 'parts' ? [src.getString('model'), src.getString('name')].filter(Boolean).join(' ') : src.getString('name');
    move.load({ kind, item: src.id, name, fromPoint, toPoint, qty, by: userId, at: new DateTime() });
    tx.save(move);
    result = { from: src, to: dst, move };
  });
  return e.json(200, result);
}, $apis.requireAuth('users'));

// --- POST /api/expert/lead — публичная заявка с сайта ---
// {name, phone, device, problem, point?, website}. point — id или адрес точки текстом (findLeadPoint); не задан или не найден —
// заявка общая (видит владелец). website — скрытое поле-ловушка: заполнено → «принято», но не сохраняется.
routerAdd('POST', '/api/expert/lead', (e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const body = e.requestInfo().body || {};
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  if (str(body.website, 500)) return e.json(200, { ok: true });
  const name = str(body.name, 200);
  const phone = str(body.phone, 50);
  if (!name) throw new BadRequestError('Укажите имя');
  if (!lib.phoneValid(phone)) throw new BadRequestError(lib.PHONE_ERR);

  // IP: e.realIP() — адрес TCP-соединения; X-Forwarded-For / X-Real-IP учитываются, только если они заданы
  // в админке (Settings → Trusted proxy headers). За nginx/Cloudflare без этой настройки все заявки придут с IP прокси.
  // Сайт пересылает заявки со своего хостинга (send-lead.php): с заголовком X-Lead-Key = CRM_LEAD_KEY из окружения
  // берётся адрес посетителя из поля ip — иначе лимит «5 в час с адреса» считал бы все заявки сайта одним адресом.
  const leadKey = $os.getenv('CRM_LEAD_KEY');
  const fromSite = !!leadKey && e.request.header.get('X-Lead-Key') === leadKey;
  const ip = (fromSite && str(body.ip, 100)) || e.realIP();
  const hourAgo = new Date(Date.now() - 3600000).toISOString().replace('T', ' ');
  const TOO_MANY = 'Слишком много заявок. Попробуйте через час или позвоните нам.';
  if (e.app.findRecordsByFilter('leads', 'ip = {:ip} && at >= {:t}', '', 5, 0, { ip, t: hourAgo }).length >= 5) {
    throw new TooManyRequestsError(TOO_MANY);
  }
  // Общий потолок — 60 заявок в час со всех адресов (защита от рассылки с многих IP).
  if (e.app.findRecordsByFilter('leads', 'at >= {:t}', '', 60, 0, { t: hourAgo }).length >= 60) {
    throw new TooManyRequestsError(TOO_MANY);
  }
  const point = lib.findLeadPoint(e.app, str(body.point, 200));

  const r = new Record(e.app.findCollectionByNameOrId('leads'));
  r.load({ name, phone, device: str(body.device, 500), problem: str(body.problem, 5000), point, status: 'new', ip, at: new DateTime() });
  e.app.save(r);
  return e.json(200, { ok: true, id: r.id });
});

// --- POST /api/expert/remind {orderId} — «Напомнить клиенту» о готовом устройстве ---
routerAdd('POST', '/api/expert/remind', (e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const body = e.requestInfo().body || {};
  let order;
  try { order = e.app.findRecordById('orders', String(body.orderId || '')); } catch (_) { throw new BadRequestError('Заказ не найден'); }
  const result = lib.notifyRemind(e.app, order, lib.authUserId(e));
  return e.json(200, { ok: true, result });
}, $apis.requireAuth('users'));

// --- закрытие месяца: создание month_closes (правило — только владелец) ---
onRecordCreateRequest((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const r = e.record;
  const month = r.getString('month');
  const b = lib.monthBounds(month);
  if (!b) throw new BadRequestError('Неверный месяц: нужен вид ГГГГ-ММ');
  if (b.toMs > Date.now()) throw new BadRequestError('Закрыть можно только прошедший месяц');
  if (e.app.findRecordsByFilter('month_closes', 'month = {:m}', '', 1, 0, { m: month }).length) {
    throw new BadRequestError('Месяц уже закрыт');
  }
  r.set('from', b.from);
  r.set('to', b.to);
  r.set('closedBy', lib.authUserId(e));
  r.set('at', new DateTime());
  e.next();
}, 'month_closes');

// --- блокировка денежных изменений в закрытом месяце (модельный уровень: API, импорт, каскады) ---
onRecordCreate((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const r = e.record;
  if (r.getString('status') === 'issued') lib.assertOpen(e.app, [r.getString('issuedAt')]);
  e.next();
}, 'orders');

onRecordUpdate((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const r = e.record, o = r.original();
  const changed = lib.ORDER_MONEY.some((f) => r.getString(f) !== o.getString(f));
  if (changed) lib.assertOpen(e.app, [o.getString('issuedAt'), r.getString('issuedAt')]);
  e.next();
}, 'orders');

onRecordDelete((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  lib.assertOpen(e.app, [e.record.getString('issuedAt')]);
  e.next();
}, 'orders');

// Запчасти заказа — по дате выдачи заказа.
onRecordCreate((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const issued = (id) => { try { return e.app.findRecordById('orders', id).getString('issuedAt'); } catch (_) { return ''; } };
  lib.assertOpen(e.app, [issued(e.record.getString('order'))]);
  e.next();
}, 'order_parts');

onRecordUpdate((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const issued = (id) => { try { return e.app.findRecordById('orders', id).getString('issuedAt'); } catch (_) { return ''; } };
  lib.assertOpen(e.app, [issued(e.record.original().getString('order')), issued(e.record.getString('order'))]);
  e.next();
}, 'order_parts');

onRecordDelete((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const issued = (id) => { try { return e.app.findRecordById('orders', id).getString('issuedAt'); } catch (_) { return ''; } };
  lib.assertOpen(e.app, [issued(e.record.getString('order'))]);
  e.next();
}, 'order_parts');

// Оплаты и продажи (at), касса и штрафы (date). Пустая дата = «сейчас» (ставится до проверки закрытого месяца).
onRecordCreate((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const name = e.record.collection().name;
  const f = name === 'payments' || name === 'sales' ? 'at' : 'date';
  if (e.record.getDateTime(f).isZero()) e.record.set(f, new DateTime());
  lib.assertOpen(e.app, [e.record.getString(f)]);
  e.next();
}, 'payments', 'sales', 'cash_ops', 'fines');

onRecordUpdate((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const name = e.record.collection().name;
  const f = name === 'payments' || name === 'sales' ? 'at' : 'date';
  lib.assertOpen(e.app, [e.record.original().getString(f), e.record.getString(f)]);
  e.next();
}, 'payments', 'sales', 'cash_ops', 'fines');

onRecordDelete((e) => {
  const lib = require(`${__hooks}/lib/expert.js`);
  const name = e.record.collection().name;
  const f = name === 'payments' || name === 'sales' ? 'at' : 'date';
  lib.assertOpen(e.app, [e.record.getString(f)]);
  e.next();
}, 'payments', 'sales', 'cash_ops', 'fines');
