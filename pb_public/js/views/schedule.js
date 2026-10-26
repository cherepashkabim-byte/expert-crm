// Вкладка «График»: смены сотрудников по дням месяца и точкам. Расставляет владелец, мастера смотрят.
// Владелец выбирает точку («кисть») и щёлкает по клеткам: пусто → смена, другая точка → заменить, та же → убрать.
// Чистые функции (monthDays, dayKey, shortPoint, shiftIndex, uncovered) — без DOM, импортируются в node-тестах.
import { plural } from '../fmt.js';

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const ERASE = 'erase';
const state = { month: null, brush: '', shown: '' }; // shown — какой месяц уже на экране (чтобы не сбивать прокрутку)

const pad = (n) => String(n).padStart(2, '0');
// День по местному времени → 'ГГГГ-ММ-ДД' (так хранится shifts.day).
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Все дни месяца, в котором лежит date: [{ key, d, wd, weekend }].
export function monthDays(date) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const n = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m, i + 1);
    return { key: dayKey(d), d: i + 1, wd: WD[d.getDay()], weekend: d.getDay() === 0 || d.getDay() === 6 };
  });
}

// Короткая подпись точки для клетки: «пр-т Притомский 31к2» → «Притом», «ул. 50 лет Октября, 13» → «50 лет».
export function shortPoint(name) {
  const s = String(name || '').replace(/^(пр-т|пр\.|просп\.|проспект|ул\.|улица|пер\.|б-р)\s*/i, '').replace(/,.*/, '').trim();
  const w = s.split(/\s+/);
  if (/^\d/.test(w[0] || '') && w[1]) return `${w[0]} ${w[1]}`.slice(0, 7);
  return (w[0] || '—').slice(0, 6);
}

// Смены по ключу «user|day».
export function shiftIndex(shifts) {
  return new Map((shifts || []).map((s) => [`${s.user}|${s.day}`, s]));
}

// Точки, где в этот день никого нет.
export function uncovered(shifts, points, day) {
  const busy = new Set((shifts || []).filter((s) => s.day === day).map((s) => s.point));
  return (points || []).filter((p) => !busy.has(p.id));
}

export default {
  id: 'schedule',
  title: 'График',
  render(el, ctx) {
    const { store, ui } = ctx;
    const { esc } = ui;
    const owner = store.isOwner;
    const me = store.me || {};
    const points = store.data.points;
    if (!state.month) state.month = new Date();
    if (owner && state.brush !== ERASE && !points.some((p) => p.id === state.brush)) state.brush = points[0]?.id || '';

    const days = monthDays(state.month);
    const today = dayKey(new Date());
    const inMonth = new Set(days.map((x) => x.key));
    const shifts = store.data.shifts.filter((s) => inMonth.has(s.day));
    const idx = shiftIndex(shifts);
    const color = (pid) => Math.max(0, points.findIndex((p) => p.id === pid)) % 6;
    const users = store.data.users
      .filter((u) => u.active !== false || shifts.some((s) => s.user === u.id))
      .sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : String(a.name || a.email).localeCompare(String(b.name || b.email), 'ru')));
    const mname = state.month.toLocaleDateString('ru-RU', { month: 'long' });
    const title = `${mname[0].toUpperCase()}${mname.slice(1)} ${state.month.getFullYear()}`;

    const brush = owner ? `<div class="sch-brush" role="group" aria-label="Чем ставить смену">
        <span class="muted small">Ставить:</span>
        ${points.map((p) => `<button type="button" class="chip btnlike sch-c${color(p.id)}${state.brush === p.id ? ' on' : ''}" data-brush="${esc(p.id)}" aria-pressed="${state.brush === p.id}">${esc(p.name)}</button>`).join('')}
        <button type="button" class="chip btnlike${state.brush === ERASE ? ' on' : ''}" data-brush="${ERASE}" aria-pressed="${state.brush === ERASE}">Выходной (стереть)</button>
      </div>
      <p class="muted small">Выберите точку и нажимайте на клетки. Нажатие той же точкой по уже стоящей смене убирает её.</p>`
      : `<div class="sch-legend">${points.map((p) => `<span class="chip sch-c${color(p.id)}">${esc(p.name)}</span>`).join('')}</div>`;

    // Ближайшие смены — для мастера сверху, чтобы не искать себя в таблице.
    const mine = store.data.shifts.filter((s) => s.user === me.id && s.day >= today).sort((a, b) => a.day.localeCompare(b.day)).slice(0, 7);
    const fmtDay = (key) => { const [y, m, d] = key.split('-').map(Number); const dt = new Date(y, m - 1, d); return `${WD[dt.getDay()]}, ${pad(d)}.${pad(m)}`; };
    const minePanel = owner ? '' : `<section class="sect"><h3>Мои ближайшие смены</h3>${mine.length
      ? `<div class="sch-mine">${mine.map((s) => `<span class="chip sch-c${color(s.point)}"><b>${esc(s.day === today ? 'сегодня' : fmtDay(s.day))}</b> · ${esc(ui.pointName(s.point))}</span>`).join('')}</div>`
      : '<p class="muted small">Смен пока не назначено.</p>'}</section>`;

    const head = `<tr><th class="sch-name">Сотрудник</th>${days.map((x) => `<th class="sch-day${x.weekend ? ' we' : ''}${x.key === today ? ' today' : ''}">${x.d}<div>${x.wd}</div></th>`).join('')}</tr>`;
    const rows = users.map((u) => {
      const n = shifts.filter((s) => s.user === u.id).length;
      return `<tr${u.id === me.id ? ' class="sch-me"' : ''}><th class="sch-name">${esc(u.name || u.email)}<div class="muted small">${n} ${plural(n, 'смена', 'смены', 'смен')}</div></th>
        ${days.map((x) => {
          const s = idx.get(`${u.id}|${x.key}`);
          const label = s ? shortPoint(ui.pointName(s.point)) : '';
          const tip = `${u.name || u.email}, ${fmtDay(x.key)}: ${s ? ui.pointName(s.point) : 'выходной'}`;
          return `<td class="sch-cell${x.weekend ? ' we' : ''}${x.key === today ? ' today' : ''}${owner ? ' edit' : ''}" data-u="${esc(u.id)}" data-d="${x.key}" title="${esc(tip)}">${s ? `<span class="sch-p sch-c${color(s.point)}">${esc(label)}</span>` : ''}</td>`;
        }).join('')}</tr>`;
    }).join('');
    const gaps = `<tr class="sch-gaps"><th class="sch-name">Точки без мастера</th>${days.map((x) => {
      const free = uncovered(shifts, points, x.key);
      return `<td class="${x.weekend ? 'we' : ''}" title="${esc(free.length ? 'Никого: ' + free.map((p) => p.name).join(', ') : 'Все точки закрыты')}">${free.length ? `<span class="sch-gap">${free.length}</span>` : '<span class="sch-ok">✓</span>'}</td>`;
    }).join('')}</tr>`;

    const mkey = days[0].key.slice(0, 7);
    const keepScroll = state.shown === mkey ? el.querySelector('.sch-wrap')?.scrollLeft : null;
    state.shown = mkey;
    el.innerHTML = `
      <div class="head"><h2>График смен</h2>
        <div class="toolbar sch-nav"><button class="btn sm ghost" data-shift="-1" aria-label="Прошлый месяц">←</button>
          <b class="sch-month">${esc(title)}</b>
          <button class="btn sm ghost" data-shift="1" aria-label="Следующий месяц">→</button>
          <button class="btn sm ghost" data-now>Текущий месяц</button></div></div>
      ${minePanel}
      ${brush}
      ${users.length ? `<div class="tw sch-wrap"><table class="sch">${head}${rows}${gaps}</table></div>` : '<p class="empty">Сотрудников пока нет — добавьте их во вкладке «Сотрудники».</p>'}`;

    // текущий месяц: прокрутить таблицу так, чтобы сегодня было видно (с парой дней до него)
    const wrap = el.querySelector('.sch-wrap');
    const th = el.querySelector('.sch-day.today');
    if (wrap && keepScroll != null) wrap.scrollLeft = keepScroll;
    else if (wrap && th) wrap.scrollLeft = Math.max(0, th.offsetLeft - el.querySelector('.sch-name').offsetWidth - th.offsetWidth * 2);

    const rerender = () => this.render(el, ctx);
    el.querySelectorAll('[data-shift]').forEach((b) => b.addEventListener('click', () => {
      state.month = new Date(state.month.getFullYear(), state.month.getMonth() + Number(b.dataset.shift), 1);
      rerender();
    }));
    el.querySelector('[data-now]').addEventListener('click', () => { state.month = new Date(); rerender(); });
    if (!owner) return;
    el.querySelectorAll('[data-brush]').forEach((b) => b.addEventListener('click', () => { state.brush = b.dataset.brush; rerender(); }));

    let busy = false;
    el.querySelector('.sch')?.addEventListener('click', async (e) => {
      const td = e.target.closest('td[data-u]');
      if (!td || busy) return;
      const cur = idx.get(`${td.dataset.u}|${td.dataset.d}`);
      const want = state.brush;
      busy = true;
      td.classList.add('wait');
      try {
        if (cur && (want === ERASE || cur.point === want)) await store.remove('shifts', cur.id);
        else if (cur) await store.update('shifts', cur.id, { point: want });
        else if (want && want !== ERASE) await store.create('shifts', { day: td.dataset.d, user: td.dataset.u, point: want });
        rerender();
      } catch (err) { ui.showError(err); td.classList.remove('wait'); } finally { busy = false; }
    });
  },
};
