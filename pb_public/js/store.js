// Связь с сервером PocketBase и данные в памяти. Прячет SDK, realtime и ошибки сети.
import PocketBase from '../vendor/pocketbase.es.mjs';

export const pb = new PocketBase(location.origin);
pb.autoCancellation(false);

// Все коллекции контракта, кроме order_log (он грузится по заказу: store.orderLog(id)).
export const COLLECTIONS = ['users', 'points', 'settings', 'clients', 'orders', 'order_parts', 'payments',
  'parts', 'products', 'sales', 'tasks', 'cash_ops', 'fines', 'visits', 'leads', 'stock_moves', 'month_closes', 'shifts', 'kb_articles'];

const POINT_KEY = 'expert.point';
// День входа по Кемерово (UTC+7): в 00:00 сессия мастера заканчивается (владельца — нет).
const DAY_KEY = 'expert.loginDay';
const workDay = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const listeners = new Set();
const netListeners = new Set();
const authLostListeners = new Set();
let subscribed = false;
let wasDisconnected = false;

const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* приватный режим */ } };
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

function emit(change) {
  for (const fn of listeners) {
    try { fn(change); } catch (e) { console.error(e); }
  }
}

function setOnline(v) {
  if (store.online === v) return;
  store.online = v;
  for (const fn of netListeners) {
    try { fn(v); } catch (e) { console.error(e); }
  }
}

const isNetErr = (e) => e && e.status === 0 && !e.isAbort;

// Любой запрос к серверу — через guard: сеть → плашка, 401 → экран входа.
async function guard(fn) {
  try {
    const r = await fn();
    setOnline(true);
    return r;
  } catch (e) {
    if (isNetErr(e)) { setOnline(false); e.isNetwork = true; }
    else if (e && e.status === 401 && pb.authStore.isValid) authLost();
    throw e;
  }
}

function authLost() {
  pb.authStore.clear();
  for (const fn of authLostListeners) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

function upsert(col, rec) {
  const arr = store.data[col] || (store.data[col] = []);
  const i = arr.findIndex((x) => x.id === rec.id);
  if (i >= 0) arr[i] = rec; else arr.push(rec);
  if (col === 'points') arr.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  if (col === 'users' && store.me && rec.id === store.me.id) pb.authStore.save(pb.authStore.token, rec);
}

function drop(col, id) {
  const arr = store.data[col];
  if (!arr) return;
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) arr.splice(i, 1);
}

async function subscribe() {
  if (subscribed) return;
  subscribed = true;
  pb.realtime.onDisconnect = () => { wasDisconnected = true; if (pb.authStore.isValid) setOnline(false); };
  await pb.realtime.subscribe('PB_CONNECT', () => {
    if (!wasDisconnected) return;
    wasDisconnected = false;
    setOnline(true);
    store.load().catch(() => {}); // после обрыва — догрузить пропущенное
  });
  await Promise.all(COLLECTIONS.map((col) => pb.collection(col).subscribe('*', (e) => {
    if (e.action === 'delete') drop(col, e.record.id); else upsert(col, e.record);
    emit({ collection: col, action: e.action, record: e.record });
  })));
}

export const store = {
  pb,
  data: Object.fromEntries(COLLECTIONS.map((c) => [c, []])),
  loaded: false,
  online: true,

  get me() { return pb.authStore.isValid ? pb.authStore.record : null; },
  get isOwner() { return !!this.me && this.me.role === 'owner'; },

  // id текущей точки ('' — не выбрана сегодня этим пользователем)
  get point() {
    const v = lsGet(POINT_KEY);
    if (!v || !this.me || v.user !== this.me.id || v.day !== localDay()) return '';
    return this.data.points.some((p) => p.id === v.id) || !this.loaded ? v.id : '';
  },
  get pointRec() { return this.data.points.find((p) => p.id === this.point) || null; },

  // Смена точки: запоминает и пишет визит (кто, точка; время ставит сервер).
  async setPoint(id) {
    lsSet(POINT_KEY, { id, user: this.me.id, day: localDay() });
    emit({ type: 'point', point: id });
    await this.create('visits', { user: this.me.id, point: id });
  },

  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  onNet(fn) { netListeners.add(fn); return () => netListeners.delete(fn); },
  onAuthLost(fn) { authLostListeners.add(fn); return () => authLostListeners.delete(fn); },

  // ---------- вход ----------

  async setupNeeded() {
    return guard(() => pb.send('/api/expert/setup', { method: 'GET' })).then((r) => !!r.needed);
  },
  async setup({ name, email, password }) {
    await guard(() => pb.send('/api/expert/setup', { method: 'POST', body: { name, email, password } }));
    return this.login(email, password);
  },
  async login(email, password) {
    const r = await guard(() => pb.collection('users').authWithPassword(email, password));
    lsDel(POINT_KEY); // после входа всегда спрашиваем точку
    lsSet(DAY_KEY, workDay());
    return r.record;
  },
  // Проверить сохранённую сессию: true — вошли, false — нужен вход. Сеть → исключение.
  async resume() {
    if (!pb.authStore.isValid) return false;
    try {
      await guard(() => pb.collection('users').authRefresh());
      if (this.dayOver) { this.logout(); return false; }
      return true;
    } catch (e) {
      if (e.isNetwork) throw e;
      pb.authStore.clear();
      return false;
    }
  },
  // Смена своего пароля. Сначала проверяем старый (входом); после смены сервер гасит старый токен,
  // поэтому сразу входим с новым паролем — сессия и выбранная точка сохраняются.
  async changePassword(oldPassword, password) {
    const email = this.me?.email;
    try {
      await guard(() => pb.collection('users').authWithPassword(email, oldPassword));
    } catch (e) {
      if (e.status === 400) throw Object.assign(new Error('Старый пароль неверный'), { status: 400 });
      throw e;
    }
    await guard(() => pb.collection('users').update(this.me.id, { oldPassword, password, passwordConfirm: password }));
    await guard(() => pb.collection('users').authWithPassword(email, password));
    lsSet(DAY_KEY, workDay());
  },
  // Мастер вошёл не сегодня (по Кемерово) — рабочий день закончился, нужен новый вход.
  get dayOver() { return !!this.me && !this.isOwner && lsGet(DAY_KEY) !== workDay(); },
  logout() {
    lsDel(POINT_KEY);
    lsDel(DAY_KEY);
    pb.realtime.unsubscribe().catch(() => {});
    subscribed = false;
    pb.authStore.clear();
    this.loaded = false;
    for (const c of COLLECTIONS) this.data[c] = [];
  },

  // ---------- данные ----------

  async load() {
    const lists = await guard(() => Promise.all(COLLECTIONS.map((col) =>
      pb.collection(col).getFullList({ batch: 1000, sort: col === 'points' ? 'sort' : 'created' }))));
    COLLECTIONS.forEach((col, i) => { this.data[col] = lists[i]; });
    this.loaded = true;
    await subscribe().catch((e) => console.warn('realtime', e));
    emit({ type: 'load' });
  },

  async create(col, data) {
    const rec = await guard(() => pb.collection(col).create(data));
    upsert(col, rec);
    emit({ collection: col, action: 'create', record: rec });
    return rec;
  },
  async update(col, id, data) {
    const rec = await guard(() => pb.collection(col).update(id, data));
    upsert(col, rec);
    emit({ collection: col, action: 'update', record: rec });
    return rec;
  },
  async remove(col, id) {
    await guard(() => pb.collection(col).delete(id));
    drop(col, id);
    emit({ collection: col, action: 'delete', record: { id } });
  },

  // Журнал изменений заказа (по времени).
  async orderLog(orderId) {
    return guard(() => pb.collection('order_log').getFullList({ filter: pb.filter('order = {:id}', { id: orderId }), sort: 'at,created' }));
  },

  // Произвольный запрос SDK через ту же обработку сети/401: store.request(() => pb.collection(...)...)
  request(fn) { return guard(fn); },
};
