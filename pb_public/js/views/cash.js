// Вкладка «Касса»: остаток наличных по точке, таблица по дням периода (по умолчанию месяц), записи ЗП / расход / «забрал».
import { pad, toInputDate as dayKey } from '../fmt.js';
import { saleSum } from '../calc.js';
import { periodBar, bindPeriod, periodTitle, statePeriod } from './finance.js';

const KINDS = [['salary', 'ЗП / аванс'], ['expense', 'Расход'], ['withdraw', 'Забрал деньги']];
const KIND_NAME = Object.fromEntries(KINDS);
const CATEGORIES = ['Аренда', 'Реклама', 'Прочее'];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const arr = (data, name) => (data && Array.isArray(data[name]) ? data[name] : []);

// Касса точки за месяц (month = 'ГГГГ-ММ') — частный случай cashPeriod.
export function cashMonth(data, pointId, month) {
  const [y, m] = String(month).split('-').map(Number);
  return cashPeriod(data, pointId, `${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`);
}

// Касса точки за период first…last ('ГГГГ-ММ-ДД', оба дня входят). Единственная денежная формула вне calc:
// остаток нал = нал-оплаты заказов точки + нал-продажи точки − записи кассы точки с fromCash = true.
// → { opening, closing, days: [{date, terminal, transfer, cash, salary, expense, withdraw, balance}], totals, entries }
export function cashPeriod(data, pointId, first, last) {
  const orderPoint = new Map(arr(data, 'orders').map((o) => [o.id, o.point]));
  const blank = () => ({ terminal: 0, transfer: 0, cash: 0, salary: 0, expense: 0, withdraw: 0, delta: 0 });
  const byDay = new Map();
  const row = (v) => {
    const k = dayKey(v);
    if (!k) return null;
    if (!byDay.has(k)) byDay.set(k, blank());
    return byDay.get(k);
  };
  const income = (method, amount, r) => {
    if (method === 'Нал') { r.cash += amount; r.delta += amount; } else if (method === 'Терминал') r.terminal += amount;
    else if (method === 'Перевод') r.transfer += amount;
  };
  for (const p of arr(data, 'payments')) {
    if (orderPoint.get(p.order) !== pointId) continue;
    const r = row(p.at || p.created);
    if (r) income(p.method, num(p.amount), r);
  }
  for (const s of arr(data, 'sales')) {
    if (s.point !== pointId) continue;
    const r = row(s.at || s.created);
    if (r) income(s.method, saleSum(s), r);
  }
  const entries = [];
  for (const c of arr(data, 'cash_ops')) {
    if (c.point !== pointId) continue;
    const r = row(c.date || c.created);
    if (!r || !(c.kind in r)) continue;
    r[c.kind] += num(c.amount);
    if (c.fromCash) r.delta -= num(c.amount);
    const k = dayKey(c.date || c.created);
    if (k >= first && k <= last) entries.push(c);
  }

  let bal = 0;
  for (const [k, r] of byDay) if (k < first) bal += r.delta;
  const opening = bal;
  const totals = blank();
  const days = [];
  const [y, m, d0] = first.split('-').map(Number);
  for (let i = 0; ; i++) {
    const date = dayKey(new Date(y, m - 1, d0 + i));
    if (date > last) break;
    const r = byDay.get(date) || blank();
    bal += r.delta;
    for (const k in totals) totals[k] += r[k];
    days.push({ date, terminal: r.terminal, transfer: r.transfer, cash: r.cash, salary: r.salary,
      expense: r.expense, withdraw: r.withdraw, balance: bal });
  }
  entries.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created).localeCompare(String(a.created)));
  return { opening, closing: bal, days, totals, entries };
}

// ---------- экран ----------

// point следует за точкой в боковой панели (store.point); ручной выбор держится до следующего переключения.
// kind/date/until — общий переключатель периода (finance.periodBar); op — что записываем (ЗП / расход / забрал).
const state = { point: '', followed: null, kind: 'month', date: '', until: '', op: 'salary', uid: '' };

export default {
  id: 'cash',
  title: 'Касса',
  render(el, ctx) {
    const { store, ui } = ctx;
    const { esc, money } = ui;
    const points = [...store.data.points].sort((a, b) => num(a.sort) - num(b.sort));
    if (state.uid !== store.me?.id) { state.uid = store.me?.id; state.point = ''; state.followed = null; }
    if (state.followed !== (store.point || '')) { state.followed = store.point || ''; state.point = state.followed; }
    if (!state.point || !points.some((p) => p.id === state.point)) state.point = store.point || points[0]?.id || '';
    if (!state.date) state.date = ui.today();
    const owner = store.isOwner;
    const { from, to } = statePeriod(state, ctx.calc);
    const first = ui.toInputDate(from);
    const last = ui.toInputDate(new Date(to.getTime() - 86400000));
    const m = cashPeriod(store.data, state.point, first, last);
    const per = state.kind === 'month' ? 'месяц' : 'период';
    const perGen = state.kind === 'month' ? 'месяца' : 'периода';
    const users = store.data.users.filter((u) => u.active !== false)
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
    const cats = [...new Set([...CATEGORIES, ...store.data.cash_ops.map((c) => c.category).filter(Boolean)])];

    const c = (v) => (v ? money(v) : '<span class="muted">·</span>');
    const rows = m.days.map((d) => `<tr><td>${esc(ui.fmtDate(d.date))}</td>
      <td class="num">${c(d.terminal)}</td><td class="num">${c(d.transfer)}</td><td class="num">${c(d.cash)}</td>
      <td class="num">${c(d.salary)}</td><td class="num">${c(d.expense)}</td><td class="num">${c(d.withdraw)}</td>
      <td class="num ${d.balance < 0 ? 'neg' : ''}"><b>${money(d.balance)}</b></td></tr>`).join('');
    const t = m.totals;
    const who = (e) => (e.kind === 'expense' ? esc(e.category || 'Прочее') + (e.who ? ` <span class="muted small">${esc(e.who)}</span>` : '')
      : esc(e.user ? ui.userName(e.user) : (e.who || '—')));
    const list = m.entries.map((e) => `<tr><td>${esc(ui.fmtDate(e.date))}</td><td>${esc(KIND_NAME[e.kind] || e.kind)}</td>
      <td>${who(e)}</td><td class="num">${money(e.amount)}</td>
      <td>${e.fromCash ? '<span class="chip">из кассы</span>' : '<span class="chip accent">не из кассы</span>'}</td>
      ${owner ? `<td><button class="del" data-del="${esc(e.id)}" title="Удалить запись" aria-label="Удалить запись">×</button></td>` : ''}</tr>`).join('');

    el.innerHTML = `
      <div class="head"><h2>Касса <span class="muted small">· ${esc(ui.pointName(state.point))}</span></h2></div>
      <div class="toolbar">
        <select id="cashPoint" aria-label="Точка">${ui.options(points, state.point)}</select>
        ${periodBar(state, ui)}
        ${state.kind === 'range' ? '' : `<span class="muted">${esc(periodTitle(state.kind, from, to, ui))}</span>`}
      </div>
      <div class="cards">
        <div class="card"><div class="l">Наличных на начало ${perGen}</div><div class="v ${m.opening < 0 ? 'neg' : ''}">${money(m.opening)}</div></div>
        <div class="card"><div class="l">Приход за ${per}</div><div class="v">${money(t.terminal + t.transfer + t.cash)}</div></div>
        <div class="card"><div class="l">Наличных на конец ${perGen}</div><div class="v ${m.closing < 0 ? 'neg' : ''}">${money(m.closing)}</div></div>
      </div>
      <p class="muted small cash-hint">Остаток нал = наличные оплаты заказов и продаж этой точки − записи кассы «из кассы» (расход «не из кассы» наличные не трогает). <a href="#help">Подробнее в «Помощи»</a></p>

      <form class="row cash-form" id="cashForm" novalidate>
        <select name="kind" aria-label="Что записать">${ui.options(KINDS, state.op)}</select>
        <input type="date" name="date" value="${esc(ui.today())}" aria-label="Дата" required>
        ${state.op === 'salary' ? `<select name="user" aria-label="Кому" required><option value="">Кому…</option>${ui.options(users, '', (u) => u.name || u.email)}</select>` : ''}
        ${state.op === 'expense' ? `<input name="category" list="cashCats" placeholder="Категория" value="Прочее" aria-label="Категория" required>
          <datalist id="cashCats">${cats.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
          <input name="who" placeholder="Комментарий" aria-label="Комментарий">` : ''}
        ${state.op === 'withdraw' ? `<select name="user" aria-label="Кто забрал">${ui.options(users, store.me?.id, (u) => u.name || u.email)}</select>` : ''}
        <input type="number" name="amount" min="1" step="1" placeholder="Сумма, ₽" aria-label="Сумма" required>
        ${state.op === 'expense' ? '<label class="check"><input type="checkbox" name="fromCash" checked> из кассы</label>' : ''}
        <button class="btn">Записать</button>
      </form>
      <p class="err" id="cashErr" hidden></p>

      <div class="tw"><table class="cash-days">
        <thead><tr><th>Дата</th><th class="num">Терминал</th><th class="num">Перевод</th><th class="num">Нал</th><th class="num">ЗП, авансы</th><th class="num">Расходы</th><th class="num">Забрал</th><th class="num">Остаток нал</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td><b>Итого</b></td><td class="num"><b>${money(t.terminal)}</b></td><td class="num"><b>${money(t.transfer)}</b></td><td class="num"><b>${money(t.cash)}</b></td>
          <td class="num"><b>${money(t.salary)}</b></td><td class="num"><b>${money(t.expense)}</b></td><td class="num"><b>${money(t.withdraw)}</b></td><td></td></tr></tfoot>
      </table></div>

      <h3>Записи за ${per}</h3>
      ${list ? `<div class="tw"><table><thead><tr><th>Дата</th><th>Что</th><th>Кому / категория</th><th class="num">Сумма</th><th></th>${owner ? '<th></th>' : ''}</tr></thead><tbody>${list}</tbody></table></div>`
        : `<p class="empty">Записей за этот ${per} нет — добавьте первую формой выше.</p>`}`;

    const rerender = () => this.render(el, { ...ctx, params: {} });
    el.querySelector('#cashPoint').addEventListener('change', (e) => { state.point = e.target.value; rerender(); });
    bindPeriod(el, state, ctx, rerender);
    const form = el.querySelector('#cashForm');
    form.elements.kind.addEventListener('change', (e) => { state.op = e.target.value; rerender(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = ui.formData(form);
      const errBox = el.querySelector('#cashErr');
      const fail = (text) => { errBox.textContent = text; errBox.hidden = false; };
      if (!f.date) return fail('Укажите дату.');
      if (!(f.amount > 0)) return fail('Укажите сумму больше нуля.');
      if (f.kind === 'salary' && !f.user) return fail('Выберите, кому выдана ЗП.');
      if (f.kind === 'expense' && !f.category) return fail('Укажите категорию расхода.');
      errBox.hidden = true;
      const rec = { point: state.point, kind: f.kind, amount: Math.round(f.amount), date: ui.fromInputDate(f.date),
        category: f.kind === 'expense' ? f.category : '', user: f.user || '', who: '',
        fromCash: f.kind === 'expense' ? !!f.fromCash : true };
      if (f.kind === 'expense') rec.who = f.who || '';
      else if (rec.user) rec.who = ui.userName(rec.user);
      try {
        await ui.busy(form.querySelector('button'), store.create('cash_ops', rec));
        ui.toast(`${KIND_NAME[f.kind]}: ${money(rec.amount)} записано`);
        // запись вне показанного периода — показать её месяц
        if (f.date < first || f.date > last) { state.kind = 'month'; state.date = f.date; }
        rerender();
      } catch (err) { ui.showError(err); }
    });
    if (!owner) return;
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const rec = store.data.cash_ops.find((x) => x.id === b.dataset.del);
      if (!rec) return;
      if (!(await ui.confirmDlg(`Удалить запись «${KIND_NAME[rec.kind]}» на ${money(rec.amount)} от ${ui.fmtDate(rec.date)}?`, { ok: 'Удалить' }))) return;
      try {
        await ui.busy(b, store.remove('cash_ops', rec.id));
        ui.toast('Запись удалена');
      } catch (err) { ui.showError(err); }
    }));
  },
};
