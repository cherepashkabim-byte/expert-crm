// Оболочка: вход, первый запуск, выбор точки, боковая панель, навигация по вкладкам.
import { store } from './store.js';
import * as ui from './ui.js';
import * as calc from './calc.js';

const { esc } = ui;

// Реестр вкладок: фиксированный порядок и пути. Каждый модуль: export default { id, title, render(el, ctx) }.
const TABS = [
  ['home', 'Главная'], ['orders', 'Заказы'], ['clients', 'Клиенты'], ['stock', 'Склад'], ['tasks', 'Задачи'], ['schedule', 'График'],
  ['cash', 'Касса'], ['finance', 'Финансы'], ['mystats', 'Моя статистика'], ['staff', 'Сотрудники'],
  ['kb', 'База знаний'], ['help', 'Помощь'], ['settings', 'Настройки'],
];
const TAB_IDS = TABS.map((t) => t[0]);
// Бывшие вкладки: старые закладки и ссылки ведут на новое место. «Продажи» теперь — режим «Заказов».
const REDIRECTS = { sales: ['orders', { view: 'sales' }] };
const resolveTab = (id, params = {}) => (REDIRECTS[id] ? [REDIRECTS[id][0], { ...REDIRECTS[id][1], ...params }] : [id, params]);

const $ = (s) => document.querySelector(s);
const app = $('#app');
const modules = {};
let [current, startParams] = resolveTab(location.hash.slice(1));
if (!TAB_IDS.includes(current)) [current, startParams] = ['home', {}];
let started = false;

// ---------- вкладки ----------

async function loadModule(id) {
  if (!modules[id]) modules[id] = (await import(`./views/${id}.js`)).default;
  return modules[id];
}

const ctx = (extra) => ({ store, ui, calc, navigate, params: {}, reason: 'data', ...extra });

let renderSeq = 0;
async function renderTab(extra = {}) {
  const seq = ++renderSeq;
  dirty = false;
  lastRender = Date.now();
  let mod;
  try {
    mod = await loadModule(current);
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="err">Не удалось загрузить раздел «${esc(TABS.find((t) => t[0] === current)[1])}». Обновите страницу.</div>`;
    return;
  }
  if (seq !== renderSeq) return;
  try {
    await mod.render(app, ctx(extra));
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="err">Ошибка в разделе: ${esc(e.message || e)}</div>`;
  }
  if (extra.reason === 'navigate') animateEnter();
}

// Появление вкладки — только при переходе (и первом показе после входа); перерисовка по данным не анимируется.
function animateEnter() {
  app.classList.remove('view-enter');
  void app.offsetWidth; // перезапуск анимации, если класс ещё стоит
  app.classList.add('view-enter');
}
app.addEventListener('animationend', (e) => { if (e.target === app) app.classList.remove('view-enter'); });

function navigate(to, extra = {}) {
  const [id, params] = resolveTab(to, extra);
  if (!TAB_IDS.includes(id)) return;
  current = id;
  if (location.hash.slice(1) !== id) history.replaceState(null, '', '#' + id);
  renderNav();
  $('#side').classList.remove('open');
  $('#burger').setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);
  renderTab({ params, reason: 'navigate' });
}

function renderNav() {
  $('#nav').innerHTML = TABS.map(([id, t]) =>
    `<button type="button" data-tab="${id}" class="${id === current ? 'active' : ''}">${esc(t)}</button>`).join('');
}

// ---------- перерисовка по данным: не чаще 300 мс, не при открытой модалке и не при фокусе в поле ----------

let dirty = false;
let lastRender = 0;
let timer = null;

function typingNow() {
  const a = document.activeElement;
  if (!a || a === document.body) return false;
  if (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable) return true;
  return a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(a.type);
}
const blocked = () => ui.isModalOpen() || typingNow() || !!$('#confirm').firstElementChild;

function scheduleRender() {
  dirty = true;
  if (timer || !started) return;
  const wait = Math.max(0, 300 - (Date.now() - lastRender));
  timer = setTimeout(() => {
    timer = null;
    if (!dirty) return;
    if (blocked()) return; // дождёмся закрытия модалки / blur
    renderTab();
  }, wait);
}
document.addEventListener('ui:modalclose', () => { if (dirty) scheduleRender(); });
document.addEventListener('focusout', () => setTimeout(() => { if (dirty) scheduleRender(); }, 0));

store.on((ch) => {
  if (ch.collection === 'points' || ch.type === 'point' || ch.type === 'load') renderPointSel();
  if (ch.collection === 'users') renderMe();
  scheduleRender();
});
store.onNet((online) => ui.setOffline(!online));
store.onAuthLost(() => { stopShell(); showLogin('Сессия закончилась, войдите снова.'); });

// ---------- боковая панель ----------

function renderPointSel() {
  const sel = $('#pointSel');
  sel.innerHTML = (store.point ? '' : '<option value="">— выберите —</option>') + ui.options(store.data.points, store.point);
}

function renderMe() {
  const me = store.me;
  if (!me) return;
  $('#me').innerHTML = `<div><b>${esc(me.name || me.email)}</b><br><span>${store.isOwner ? 'Владелец' : 'Мастер'}</span></div>
    <div class="me-btns"><button class="btn sm" type="button" id="changePass">Сменить пароль</button>
    <button class="btn sm" type="button" id="logout">Выйти</button></div>`;
}

// Смена своего пароля — доступна каждому; забытый пароль сбрасывает владелец во вкладке «Сотрудники».
function passwordDialog() {
  ui.openModal(`
    <div class="head"><h2>Сменить пароль</h2><button type="button" class="x-close" data-close aria-label="Закрыть">×</button></div>
    <form id="passForm" novalidate>
      <div class="fields">
        <label class="full">Старый пароль<input name="old" type="password" autocomplete="current-password" autofocus></label>
        <label>Новый пароль (не короче 8)<input name="password" type="password" autocomplete="new-password"></label>
        <label>Повторите новый пароль<input name="again" type="password" autocomplete="new-password"></label>
        <label class="check full"><input type="checkbox" data-show> Показать пароли</label>
      </div>
      <div class="err" hidden></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn" type="submit">Сменить</button></div>
    </form>`, (box) => {
    const form = box.querySelector('#passForm');
    const err = form.querySelector('.err');
    box.querySelector('[data-show]').addEventListener('change', (e) => {
      form.querySelectorAll('input[name]').forEach((i) => { i.type = e.target.checked ? 'text' : 'password'; });
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // напрямую, а не formData: при «Показать пароли» поле становится text, а formData обрезает пробелы
      const [old, password, again] = ['old', 'password', 'again'].map((n) => form[n].value);
      let bad = '';
      if (!old) bad = 'Введите старый пароль';
      else if (password.length < 8) bad = 'Новый пароль должен быть не короче 8 символов';
      else if (password !== again) bad = 'Новые пароли не совпадают';
      else if (password === old) bad = 'Новый пароль совпадает со старым';
      err.textContent = bad;
      err.hidden = !bad;
      if (bad) return;
      try {
        await ui.busy(form.querySelector('[type=submit]'), store.changePassword(old, password));
        ui.closeModal();
        ui.toast('Пароль изменён. В следующий раз входите с новым паролем.');
      } catch (ex) {
        err.textContent = ui.errorText(ex);
        err.hidden = false;
      }
    });
  });
}

const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
let clockTimer = null;
function tick() {
  const d = new Date();
  const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  $('#clock').innerHTML = `<div class="time">${t}</div><div>${ui.fmtDate(d)}, ${DAYS[d.getDay()]}</div>`;
}

$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) navigate(b.dataset.tab);
});
$('#burger').addEventListener('click', () => {
  const open = $('#side').classList.toggle('open');
  $('#burger').setAttribute('aria-expanded', String(open));
});
$('#me').addEventListener('click', async (e) => {
  if (e.target.closest('#changePass')) { passwordDialog(); return; }
  if (!e.target.closest('#logout')) return;
  stopShell();
  store.logout();
  showLogin();
});
$('#pointSel').addEventListener('change', async (e) => {
  const id = e.target.value;
  if (!id || id === store.point) return;
  e.target.blur();
  try {
    await store.setPoint(id);
    ui.toast('Точка: ' + ui.pointName(id));
  } catch (err) { ui.showError(err); }
});
window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (started && REDIRECTS[id]) navigate(id);
  else if (started && TAB_IDS.includes(id) && id !== current) navigate(id);
});

// ---------- выбор точки ----------

function askPoint() {
  return new Promise((resolve) => {
    const pts = store.data.points;
    ui.openModal(`<h2>Где вы сегодня работаете?</h2>
      <p class="muted small">Время входа запишется в журнал.</p>
      <div class="point-list">${pts.map((p) => `<button type="button" data-p="${esc(p.id)}">${esc(p.name)}${p.address && p.address !== p.name ? `<small>${esc(p.address)}</small>` : ''}</button>`).join('')}</div>
      <div class="err" id="ptErr" hidden></div>`, (box) => {
      box.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', async () => {
        const err = box.querySelector('#ptErr');
        err.hidden = true;
        try {
          await ui.busy(b, store.setPoint(b.dataset.p));
          ui.closeModal();
          resolve();
        } catch (e2) {
          err.textContent = ui.errorText(e2);
          err.hidden = false;
        }
      }));
      box.querySelector('[data-p]')?.focus();
    }, { sticky: true });
  });
}

// ---------- вход и первый запуск ----------

function authScreen(inner) {
  document.body.classList.add('auth');
  app.innerHTML = `<div class="auth-card"><div class="wordmark" role="img" aria-label="Эксперт — ремонт смартфонов"><span class="w-name"><span class="w-ek">ЭК</span><span class="w-spert">СПЕРТ</span></span><small>Не вывеска, а то, как мы работаем</small></div>${inner}</div>`;
}

function showLogin(note) {
  authScreen(`<h1>Вход в CRM</h1>
    ${note ? `<p class="muted small">${esc(note)}</p>` : ''}
    <form class="stack" id="loginForm" novalidate>
      <label>Почта<input name="email" type="email" autocomplete="username" required></label>
      <label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
      <div class="err" id="loginErr" hidden></div>
      <button class="btn" type="submit">Войти</button>
    </form>`);
  const form = $('#loginForm');
  form.email.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { email, password } = ui.formData(form);
    const err = $('#loginErr');
    err.hidden = true;
    if (!email || !password) { err.textContent = 'Введите почту и пароль'; err.hidden = false; return; }
    try {
      await ui.busy(form.querySelector('button'), store.login(email, password));
      await startShell();
    } catch (e2) {
      err.textContent = e2.status === 400 ? 'Неверная почта или пароль' : ui.errorText(e2);
      err.hidden = false;
      form.password.value = '';
      form.password.focus();
    }
  });
}

function showSetup() {
  authScreen(`<h1>Первый запуск — создайте учётную запись владельца</h1>
    <p class="muted small">Эта учётная запись сможет добавлять мастеров и менять настройки.</p>
    <form class="stack" id="setupForm" novalidate>
      <label>Имя<input name="name" autocomplete="name" required></label>
      <label>Почта<input name="email" type="email" autocomplete="username" required></label>
      <label>Пароль (не короче 8 символов)<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <div class="err" id="setupErr" hidden></div>
      <button class="btn" type="submit">Создать и войти</button>
    </form>`);
  const form = $('#setupForm');
  form.name.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = ui.formData(form);
    const err = $('#setupErr');
    err.hidden = true;
    const bad = !d.name ? 'Укажите имя' : !d.email ? 'Укажите почту' : d.password.length < 8 ? 'Пароль должен быть не короче 8 символов' : '';
    if (bad) { err.textContent = bad; err.hidden = false; return; }
    try {
      await ui.busy(form.querySelector('button'), store.setup(d));
      await startShell();
    } catch (e2) {
      if (e2.status === 403) { showLogin('Владелец уже создан. Войдите по почте и паролю.'); return; }
      err.textContent = ui.errorText(e2);
      err.hidden = false;
    }
  });
}

// ---------- запуск ----------

async function startShell() {
  app.innerHTML = '<p class="empty">Загрузка данных…</p>';
  await store.load();
  document.body.classList.remove('auth');
  renderNav();
  renderMe();
  renderPointSel();
  tick();
  clearInterval(clockTimer);
  clockTimer = setInterval(tick, 15000);
  if (!store.point) await askPoint();
  started = true;
  navigate(current, startParams);
  startParams = {};
}

function stopShell() {
  started = false;
  clearInterval(clockTimer);
  ui.closeModal();
}

async function boot() {
  try {
    if (await store.resume()) { await startShell(); return; }
    if (await store.setupNeeded()) showSetup(); else showLogin();
  } catch (e) {
    ui.setOffline(true);
    authScreen(`<h1>Нет связи с сервером</h1><p class="muted">Проверьте, что сервер CRM запущен (start.bat), и нажмите «Повторить».</p>
      <div class="actions"><button class="btn" id="retry">Повторить</button></div>`);
    $('#retry').addEventListener('click', () => { ui.setOffline(false); boot(); });
  }
}

boot();
