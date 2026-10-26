/// <reference path="../pb_data/types.d.ts" />
// Схема CRM «Эксперт»: коллекции, поля, правила доступа, 4 точки, settings, бэкапы.

const AUTH = '@request.auth.id != ""';
const OWNER = '@request.auth.role = "owner"';

const TEMPLATE = `# ДОГОВОР № {{номер}}
# на ремонт устройства и акт приёма-передачи

{{сервис}} сервис, {{дата}}

{{организация}} (ИНН {{инн}}), далее «Исполнитель», и {{клиент}}, тел. {{телефон}}, далее «Заказчик», заключили договор о нижеследующем.

1. Предмет договора
1.1. Заказчик передаёт, а Исполнитель принимает в ремонт устройство: {{тип}} {{модель}}, цвет {{цвет}}.
1.2. Вид работ: диагностика и ремонт по заявленной неисправности.
1.3. Заявленная неисправность: {{неисправность}}. Комплектация, внешний вид: {{внешний_вид}}.

2. Стоимость и оплата
2.1. Предварительная стоимость работ: {{примерная_цена}}. Окончательная стоимость: {{цена}}. Внесено при приёме: {{предоплата}}. К оплате при выдаче: {{остаток}}.
2.2. Оплата принимается наличными, переводом или картой при выдаче устройства.

3. Сроки
3.1. Планируемый срок ремонта: до {{срок}}. Срок может быть продлён при ожидании запчастей, о чём Исполнитель уведомляет Заказчика.

4. Гарантия
4.1. Гарантия на выполненные работы и установленные запчасти: {{гарантия}} мес. с даты выдачи.
4.2. Гарантия не распространяется на механические повреждения, следы попадания влаги и вскрытия третьими лицами после выдачи.

5. Прочие условия
5.1. При вскрытии устройства могут быть выявлены скрытые неисправности; их устранение и стоимость согласуются с Заказчиком дополнительно.
5.2. Если Заказчик отказывается от ремонта, он оплачивает стоимость диагностики и фактически выполненных работ.
5.3. Исполнитель не отвечает за сохранность данных на устройстве. Резервное копирование — обязанность Заказчика.
5.4. Устройство, не забранное в течение 30 дней после уведомления о готовности, может быть удержано Исполнителем до оплаты хранения.

Реквизиты сторон
Исполнитель: {{организация}}, {{адрес}}, тел. {{телефон_точки}}. Принял: {{принял}}. Мастер: {{мастер}}.
Заказчик: {{клиент}}, тел. {{телефон}}.

Подпись Исполнителя: ____________________          Подпись Заказчика: ____________________

Устройство получено после ремонта, работы выполнены в полном объёме, претензий не имею.
Дата выдачи: {{дата_выдачи}}          Подпись Заказчика: ____________________`;

const POINTS = [
  { name: 'пр-т Притомский 31к2', address: 'пр-т Притомский 31к2', rate: 0.4, sort: 1 },
  { name: 'пр-т Советский 24', address: 'пр-т Советский 24', rate: 0.35, sort: 2 },
  { name: 'ул. 50 лет Октября, 13', address: 'ул. 50 лет Октября, 13', rate: 0.35, sort: 3 },
  { name: 'пр-т Шахтёров, 83', address: 'пр-т Шахтёров, 83', rate: 0.35, sort: 4 },
];

const NAMES = ['points', 'clients', 'parts', 'products', 'settings', 'orders', 'order_parts', 'payments',
  'sales', 'tasks', 'cash_ops', 'fines', 'visits', 'order_log'];

migrate((app) => {
  const T = (name, max) => ({ name, type: 'text', max: max || 0 });
  const N = (name) => ({ name, type: 'number' });
  const B = (name) => ({ name, type: 'bool' });
  const D = (name) => ({ name, type: 'date' });
  const S = (name, values) => ({ name, type: 'select', maxSelect: 1, values });
  const R = (name, collectionId, opts) => Object.assign({ name, type: 'relation', collectionId, maxSelect: 1, cascadeDelete: false }, opts || {});
  const STAMPS = [
    { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
    { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
  ];

  // Обычная «рабочая» коллекция: читают и пишут все вошедшие, удаляет только владелец.
  const make = (name, fields, rules, indexes) => {
    const c = new Collection(Object.assign({
      type: 'base', name,
      listRule: AUTH, viewRule: AUTH, createRule: AUTH, updateRule: AUTH, deleteRule: OWNER,
      fields: fields.concat(STAMPS),
      indexes: indexes || [],
    }, rules || {}));
    app.save(c);
    return c;
  };

  // --- users ---
  const users = app.findCollectionByNameOrId('users');
  if (!users.fields.getByName('name')) users.fields.add(new TextField({ name: 'name', max: 255 }));
  users.fields.add(new SelectField({ name: 'role', maxSelect: 1, values: ['owner', 'master'] }));
  users.fields.add(new BoolField({ name: 'active' }));
  users.listRule = AUTH;
  users.viewRule = AUTH;
  users.createRule = OWNER;
  users.deleteRule = OWNER;
  users.updateRule = OWNER + ' || (id = @request.auth.id && @request.body.role:isset = false && @request.body.active:isset = false)';
  users.manageRule = OWNER;
  users.authRule = 'active = true';
  users.passwordAuth.enabled = true;
  users.passwordAuth.identityFields = ['email'];
  app.save(users);
  const U = users.id;

  const points = make('points', [T('name'), T('address'), T('phone'), N('rate'), N('sort')],
    { createRule: null, deleteRule: null, updateRule: OWNER });
  const clients = make('clients', [T('name'), T('phone'), T('phoneDigits'), T('source'), T('note', 10000), T('legacyId')], null,
    ['CREATE INDEX idx_clients_phoneDigits ON clients (phoneDigits)']);
  const parts = make('parts', [T('model'), T('name'), T('category'), T('supplier'), N('cost'), N('stock'), T('comment', 10000), T('legacyId')]);
  const products = make('products', [T('name'), T('category'), N('cost'), N('price'), N('stock')]);
  make('settings', [T('org'), T('inn'), T('template', 200000), N('salesRate')],
    { createRule: null, deleteRule: null, updateRule: OWNER });

  const orders = make('orders', [
    N('num'), R('client', clients.id), R('point', points.id),
    S('status', ['new', 'diag', 'wait', 'work', 'ready', 'issued', 'refuse']),
    T('source'), T('deviceType'), T('model'), T('color'), T('appearance', 10000), T('fault', 10000), N('approxPrice'),
    R('acceptedBy', U), T('acceptedName'), R('repairedBy', U), T('repairedName'),
    N('price'), N('warranty'), N('courier'), S('payMethod', ['Нал', 'Перевод', 'Терминал']),
    D('due'), D('acceptedAt'), D('issuedAt'), T('note', 10000), B('notifySms'),
    { name: 'masterPayManual', type: 'json', maxSize: 100 }, T('legacyId'),
  ], null, ['CREATE UNIQUE INDEX idx_orders_num ON orders (num)']);

  make('order_parts', [R('order', orders.id, { required: true, cascadeDelete: true }), R('part', parts.id), T('name'), N('qty'), N('cost'), T('legacyKey')]);
  make('payments', [R('order', orders.id, { required: true, cascadeDelete: true }), N('amount'), T('method'), D('at'), R('by', U), T('legacyId')]);
  make('sales', [R('product', products.id), N('qty'), N('price'), N('cost'), R('point', points.id), R('seller', U), T('method'), D('at')]);
  make('tasks', [T('title'), T('description', 10000), S('status', ['new', 'work', 'done']), R('assignee', U), R('point', points.id), D('due'), R('createdBy', U)]);
  make('cash_ops', [R('point', points.id), S('kind', ['salary', 'expense', 'withdraw']), T('category'), R('user', U), T('who'), N('amount'), D('date'), B('fromCash'), T('legacyId')]);
  make('fines', [R('user', U), T('userName'), N('amount'), T('reason', 10000), D('date'), T('legacyId')]);
  make('visits', [R('user', U), R('point', points.id), D('at')]);
  make('order_log', [R('order', orders.id, { required: true, cascadeDelete: true }), R('user', U), T('field'), T('old', 100000), T('new', 100000), D('at')],
    { createRule: null, updateRule: null, deleteRule: null });

  // --- данные ---
  for (const p of POINTS) {
    const r = new Record(points);
    r.load(Object.assign({ phone: '' }, p));
    app.save(r);
  }
  const st = new Record(app.findCollectionByNameOrId('settings'));
  st.load({ org: '', inn: '', template: TEMPLATE, salesRate: 0 });
  app.save(st);

  // --- бэкапы ---
  const s = app.settings();
  s.backups.cron = '0 3 * * *';
  s.backups.cronMaxKeep = 14;
  app.save(s);
}, (app) => {
  for (const name of NAMES.slice().reverse()) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const users = app.findCollectionByNameOrId('users');
  users.fields.removeByName('role');
  users.fields.removeByName('active');
  app.save(users);
});
