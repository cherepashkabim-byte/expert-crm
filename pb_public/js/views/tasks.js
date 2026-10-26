// Вкладка «Задачи»: создание, фильтры по статусу, смена статуса в один клик, просрочка.
// Удаление — только владелец.

const STATUS = { new: 'Новая', work: 'В работе', done: 'Завершена' };
const FILTERS = [['new', 'Новые'], ['work', 'В работе'], ['done', 'Завершённые'], ['all', 'Все']];
// Следующий шаг статуса: кнопка в строке.
const NEXT = { new: ['work', 'Взять в работу'], work: ['done', 'Завершить'], done: ['work', 'Вернуть в работу'] };
const CHIP = { new: 'accent', work: '', done: 'ok' };
// point следует за точкой в боковой панели (store.point); «Все точки» держится до следующего переключения.
// Задачи без точки — общие, видны в любой точке.
const state = { filter: 'new', mine: false, point: '', followed: null };

function isOverdue(t, ui) {
  if (!t.due || t.status === 'done') return false;
  const d = ui.toInputDate(t.due);
  return !!d && d < ui.today();
}

export default {
  id: 'tasks',
  title: 'Задачи',
  render(el, ctx) {
    const { store, ui } = ctx;
    const { esc } = ui;
    const owner = store.isOwner;
    const me = store.me || {};
    if (state.followed !== (store.point || '')) { state.followed = store.point || ''; state.point = state.followed; }
    const base = store.data.tasks.filter((t) => (!state.mine || t.assignee === me.id)
      && (!state.point || !t.point || t.point === state.point));
    const count = (f) => (f === 'all' ? base.length : base.filter((t) => (t.status || 'new') === f).length);
    const order = { new: 0, work: 0, done: 1 };
    const list = base
      .filter((t) => state.filter === 'all' || (t.status || 'new') === state.filter)
      .sort((a, b) => (order[a.status] ?? 0) - (order[b.status] ?? 0)
        || Number(isOverdue(b, ui)) - Number(isOverdue(a, ui))
        || (a.due ? 0 : 1) - (b.due ? 0 : 1)
        || String(a.due || '').localeCompare(String(b.due || ''))
        || String(b.created).localeCompare(String(a.created)));
    const overdueN = base.filter((t) => isOverdue(t, ui)).length;

    const rows = list.map((t) => {
      const st = t.status || 'new';
      const late = isOverdue(t, ui);
      const [next, nextLabel] = NEXT[st];
      return `<tr class="${late ? 'late' : ''}${st === 'done' ? ' off' : ''}">
        <td><span class="chip ${CHIP[st]}">${STATUS[st]}</span></td>
        <td class="task-title"><button class="linklike" data-edit="${esc(t.id)}">${esc(t.title || '(без названия)')}</button>
          ${t.description ? `<div class="muted small task-desc">${esc(t.description)}</div>` : ''}</td>
        <td>${t.assignee ? esc(ui.userName(t.assignee)) : '<span class="muted">—</span>'}</td>
        <td>${t.point ? esc(ui.pointName(t.point)) : '<span class="chip">общая</span>'}</td>
        <td>${t.due ? `${esc(ui.fmtDate(t.due))}${late ? ' <span class="chip bad">просрочена</span>' : ''}` : '<span class="muted">—</span>'}</td>
        <td><button class="btn sm${st === 'done' ? ' ghost' : ''}" data-st="${esc(t.id)}" data-next="${next}">${nextLabel}</button></td>
        ${owner ? `<td><button class="del" data-del="${esc(t.id)}" title="Удалить задачу" aria-label="Удалить задачу">×</button></td>` : ''}</tr>`;
    }).join('');

    let empty = '';
    if (!store.data.tasks.length) empty = '<p class="empty">Задач пока нет — <button class="btn sm" data-add>Создать задачу</button></p>';
    else if (!list.length) {
      const what = { new: 'Новых задач нет', work: 'Задач в работе нет', done: 'Завершённых задач нет', all: 'Задач нет' }[state.filter];
      empty = `<p class="empty">${what}${state.mine ? ' среди ваших' : ''}${state.point ? ' на этой точке' : ''} — <button class="btn sm" data-add>Создать задачу</button></p>`;
    }

    el.innerHTML = `
      <div class="head"><h2>Задачи <span class="muted small">· ${esc(state.point ? ui.pointName(state.point) : 'все точки')}</span></h2><button class="btn" data-add>+ Задача</button></div>
      <div class="toolbar">
        ${FILTERS.map(([f, t]) => `<button class="chip btnlike task-f${state.filter === f ? ' on accent' : ''}" data-f="${f}">${t} <b>${count(f)}</b></button>`).join('')}
        <select id="tPoint" aria-label="Точка"><option value="">Все точки</option>${ui.options(store.data.points, state.point)}</select>
        <label class="check task-mine"><input type="checkbox" id="tMine"${state.mine ? ' checked' : ''}> Только мои</label>
        ${overdueN ? `<span class="chip bad">Просрочено: ${overdueN}</span>` : ''}
      </div>
      ${list.length ? `<div class="tw"><table class="tasks-t">
        <thead><tr><th>Статус</th><th>Что сделать</th><th>Кому</th><th>Точка</th><th>Срок</th><th></th>${owner ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows}</tbody></table></div>` : empty}`;

    const rerender = () => this.render(el, ctx);
    el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.f; rerender(); }));
    el.querySelector('#tPoint').addEventListener('change', (e) => { state.point = e.target.value; rerender(); });
    el.querySelector('#tMine').addEventListener('change', (e) => { state.mine = e.target.checked; rerender(); });
    el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => taskDialog(ctx)));
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => taskDialog(ctx, b.dataset.edit)));
    el.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await ui.busy(b, store.update('tasks', b.dataset.st, { status: b.dataset.next }));
        ui.toast(`Задача: ${STATUS[b.dataset.next].toLowerCase()}`);
      } catch (err) { ui.showError(err); }
    }));
    if (owner) el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const t = store.data.tasks.find((x) => x.id === b.dataset.del);
      if (!t) return;
      if (!(await ui.confirmDlg(`Удалить задачу «${t.title}»?`, { ok: 'Удалить' }))) return;
      try { await ui.busy(b, store.remove('tasks', t.id)); ui.toast('Задача удалена'); } catch (err) { ui.showError(err); }
    }));
  },
};

function taskDialog({ store, ui }, id) {
  const { esc } = ui;
  const t = id ? store.data.tasks.find((x) => x.id === id) : null;
  if (id && !t) return;
  const users = store.data.users.filter((u) => u.active || (t && u.id === t.assignee));
  const v = t || { status: 'new', point: store.point || '', assignee: '', due: '' };
  ui.openModal(`
    <h3>${t ? 'Задача' : 'Новая задача'}</h3>
    <form class="fields" novalidate>
      <label class="full">Что сделать *<input name="title" value="${esc(v.title || '')}" placeholder="Заказать дисплеи на iPhone 11" required autofocus></label>
      <label class="full">Описание<textarea name="description" rows="3">${esc(v.description || '')}</textarea></label>
      <label>Кому<select name="assignee"><option value="">— не назначено —</option>${ui.options(users, v.assignee, (u) => u.name || u.email)}</select></label>
      <label>Точка<select name="point"><option value="">— общая (все точки) —</option>${ui.options(store.data.points, v.point)}</select></label>
      <label>Срок<input name="due" type="date" value="${esc(ui.toInputDate(v.due))}"></label>
      ${t ? `<label>Статус<select name="status">${ui.options(Object.entries(STATUS), v.status || 'new')}</select></label>
        <p class="muted small full">Создал: ${esc(ui.userName(t.createdBy))}, ${esc(ui.fmtDateTime(t.created))}</p>` : ''}
      <p class="err full" hidden></p>
      <div class="actions full"><button type="button" class="btn ghost" data-close>Отмена</button>
        <button class="btn" type="submit">${t ? 'Сохранить' : 'Создать'}</button></div>
    </form>`, (box) => {
    const form = box.querySelector('form');
    const err = box.querySelector('.err');
    if (t) {
      const off = store.on((ch) => {
        if (ch.collection === 'tasks' && ch.action === 'delete' && ch.record?.id === id) {
          err.textContent = 'Эту задачу удалили.'; err.hidden = false;
          form.querySelector('[type=submit]').disabled = true;
        }
      });
      document.addEventListener('ui:modalclose', off, { once: true });
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = ui.formData(form);
      err.hidden = true;
      form.title.classList.toggle('bad', !d.title);
      if (!d.title) { err.textContent = 'Напишите, что нужно сделать'; err.hidden = false; form.title.focus(); return; }
      d.due = ui.fromInputDate(d.due);
      try {
        if (t) await ui.busy(form.querySelector('[type=submit]'), store.update('tasks', t.id, d));
        else await ui.busy(form.querySelector('[type=submit]'), store.create('tasks', { ...d, status: 'new', createdBy: store.me?.id || '' }));
        ui.closeModal();
        ui.toast(t ? 'Задача сохранена' : 'Задача создана');
      } catch (ex) { err.textContent = ui.errorText(ex); err.hidden = false; }
    });
  });
}
