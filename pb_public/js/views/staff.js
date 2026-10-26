// Вкладка «Сотрудники»: учётные записи и журнал входов. Управление — только у владельца.

const ROLES = [['master', 'Мастер'], ['owner', 'Владелец']];
const LOG_LIMIT = 300;
const state = { who: '', day: '' }; // фильтры журнала входов

export default {
  id: 'staff',
  title: 'Сотрудники',
  render(el, { store, ui }) {
    const { esc } = ui;
    const owner = store.isOwner;
    const me = store.me;
    const users = [...store.data.users].sort((a, b) =>
      (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || String(a.name).localeCompare(String(b.name), 'ru'));
    const visits = [...store.data.visits].sort((a, b) => String(b.at || b.created).localeCompare(String(a.at || a.created)));
    const lastVisit = new Map();
    for (const v of visits) if (!lastVisit.has(v.user)) lastVisit.set(v.user, v);

    const rows = users.map((u) => {
      const lv = lastVisit.get(u.id);
      const self = me && u.id === me.id;
      const role = owner && !self
        ? `<select data-role="${esc(u.id)}" aria-label="Роль">${ui.options(ROLES, u.role)}</select>`
        : (u.role === 'owner' ? 'Владелец' : 'Мастер');
      const acts = owner ? `<td>
          ${self ? '<span class="muted small">это вы</span>' : `<button class="btn sm ${u.active ? 'danger' : 'ghost'}" data-toggle="${esc(u.id)}">${u.active ? 'Отключить' : 'Включить'}</button>`}
          ${self ? '' : `<button class="btn sm ghost" data-reset="${esc(u.id)}">Сбросить пароль</button>`}</td>` : '';
      return `<tr class="${u.active ? '' : 'off'}">
        <td>${esc(u.name || '—')}</td>
        <td>${esc(u.email || '—')}</td>
        <td>${role}</td>
        <td>${u.active ? '<span class="chip ok">Активен</span>' : '<span class="chip bad">Отключён</span>'}</td>
        <td>${lv ? `${esc(ui.fmtDateTime(lv.at || lv.created))} <span class="muted small">${esc(ui.pointName(lv.point))}</span>` : '<span class="muted">—</span>'}</td>
        ${acts}</tr>`;
    }).join('');

    const masters = users.filter((u) => u.role === 'master');
    const emptyMasters = masters.length ? '' : `<p class="empty">Мастеров пока нет${owner ? ' — <button class="btn sm" data-add>Добавить сотрудника</button>' : ''}</p>`;

    const log = visits.filter((v) => (!state.who || v.user === state.who)
      && (!state.day || ui.toInputDate(v.at || v.created) === state.day));
    const logRows = log.slice(0, LOG_LIMIT).map((v) => `<tr>
        <td>${esc(ui.fmtDateTime(v.at || v.created))}</td><td>${esc(ui.userName(v.user))}</td><td>${esc(ui.pointName(v.point))}</td></tr>`).join('');

    el.innerHTML = `
      <div class="head"><h2>Сотрудники</h2>${owner ? '<button class="btn" data-add>+ Добавить сотрудника</button>' : ''}</div>
      <div class="tw"><table>
        <thead><tr><th>Имя</th><th>Почта</th><th>Роль</th><th>Статус</th><th>Последний вход</th>${owner ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${emptyMasters}
      <h3>Журнал входов</h3>
      <div class="toolbar">
        <select id="logWho" aria-label="Сотрудник"><option value="">Все сотрудники</option>${ui.options(users, state.who, (u) => u.name || u.email)}</select>
        <input type="date" id="logDay" value="${esc(state.day)}" aria-label="Дата">
        ${state.who || state.day ? '<button class="btn sm ghost" id="logReset">Сбросить</button>' : ''}
      </div>
      ${log.length ? `<div class="tw"><table><thead><tr><th>Время</th><th>Кто</th><th>Точка</th></tr></thead><tbody>${logRows}</tbody></table></div>
        ${log.length > LOG_LIMIT ? `<p class="muted small">Показаны последние ${LOG_LIMIT} из ${log.length}. Уточните фильтр.</p>` : ''}`
        : `<p class="empty">${state.who || state.day ? 'Входов по фильтру нет' : 'Входов пока нет'}</p>`}`;

    const rerender = () => this.render(el, { store, ui });
    el.querySelector('#logWho').addEventListener('change', (e) => { state.who = e.target.value; rerender(); });
    el.querySelector('#logDay').addEventListener('change', (e) => { state.day = e.target.value; rerender(); });
    el.querySelector('#logReset')?.addEventListener('click', () => { state.who = ''; state.day = ''; rerender(); });
    if (!owner) return;

    el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addDialog(store, ui)));
    el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const u = store.data.users.find((x) => x.id === b.dataset.toggle);
      if (!u) return;
      if (u.active && !(await ui.confirmDlg(`Отключить «${u.name || u.email}»? Он не сможет войти, пока вы его не включите.`, { ok: 'Отключить' }))) return;
      try {
        await ui.busy(b, store.update('users', u.id, { active: !u.active }));
        ui.toast(u.active ? 'Сотрудник отключён' : 'Сотрудник включён');
      } catch (err) { ui.showError(err); }
    }));
    el.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', async () => {
      const u = store.data.users.find((x) => x.id === s.dataset.role);
      try {
        await store.update('users', u.id, { role: s.value });
        s.blur();
        ui.toast('Роль изменена');
      } catch (err) { s.value = u.role; ui.showError(err); }
    }));
    el.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => resetDialog(store, ui, b.dataset.reset)));
  },
};

function passwordError(p) {
  return p.length < 8 ? 'Пароль должен быть не короче 8 символов' : '';
}

function addDialog(store, ui) {
  ui.openModal(`
    <div class="head"><h2>Новый сотрудник</h2><button class="x-close" data-close aria-label="Закрыть">×</button></div>
    <form id="addForm" novalidate>
      <div class="fields">
        <label>Имя<input name="name" required autofocus></label>
        <label>Почта (для входа)<input name="email" type="email" required></label>
        <label>Временный пароль (не короче 8)<input name="password" type="text" autocomplete="off" required></label>
        <label>Роль<select name="role">${ui.options(ROLES, 'master')}</select></label>
      </div>
      <p class="muted small">Передайте сотруднику почту и пароль. После входа он сменит его на свой кнопкой «Сменить пароль» внизу боковой панели.</p>
      <div class="err" id="addErr" hidden></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn" type="submit">Добавить</button></div>
    </form>`, (box) => {
    const form = box.querySelector('#addForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = ui.formData(form);
      const err = box.querySelector('#addErr');
      err.hidden = true;
      const bad = !d.name ? 'Укажите имя' : !d.email ? 'Укажите почту' : passwordError(d.password);
      if (bad) { err.textContent = bad; err.hidden = false; return; }
      try {
        await ui.busy(form.querySelector('[type=submit]'), store.create('users', {
          name: d.name, email: d.email, password: d.password, passwordConfirm: d.password,
          role: d.role, active: true, emailVisibility: true,
        }));
        ui.closeModal();
        ui.toast('Сотрудник добавлен');
      } catch (e2) {
        err.textContent = ui.errorText(e2);
        err.hidden = false;
      }
    });
  });
}

function resetDialog(store, ui, id) {
  const u = store.data.users.find((x) => x.id === id);
  if (!u) return;
  ui.openModal(`
    <div class="head"><h2>Новый пароль</h2><button class="x-close" data-close aria-label="Закрыть">×</button></div>
    <p>${ui.esc(u.name || u.email)}</p>
    <form id="resetForm" novalidate>
      <div class="fields"><label>Новый пароль (не короче 8)<input name="password" type="text" autocomplete="off" required autofocus></label></div>
      <div class="err" id="resetErr" hidden></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn" type="submit">Сохранить</button></div>
    </form>`, (box) => {
    const form = box.querySelector('#resetForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { password } = ui.formData(form);
      const err = box.querySelector('#resetErr');
      const bad = passwordError(password);
      if (bad) { err.textContent = bad; err.hidden = false; return; }
      try {
        await ui.busy(form.querySelector('[type=submit]'), store.update('users', id, { password, passwordConfirm: password }));
        ui.closeModal();
        ui.toast('Пароль изменён. Передайте его сотруднику.');
      } catch (e2) {
        err.textContent = ui.errorText(e2);
        err.hidden = false;
      }
    });
  });
}
