// Вкладка «Финансы»: сводка за день/неделю/месяц по всем точкам или одной, мастера, расходы, штрафы,
// «Откуда клиенты», расходы на гарантию, выгрузка в Excel, закрытие/открытие месяца (владелец).
// Все денежные цифры — из calc.finance / calc.periodRange.
import { toPct } from '../calc.js';
import { ordersSheet } from './order-lib.js';

const KINDS = [['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц'], ['range', 'Период']];
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

// ---------- переключатель периода (общий с «Моей статистикой») ----------

export function periodTitle(kind, from, to, ui) {
  if (kind === 'month') return `${MONTHS[from.getMonth()]} ${from.getFullYear()}`;
  const last = new Date(to.getTime() - 86400000);
  if (kind === 'week' || (kind === 'range' && last > from)) return `${ui.fmtDate(from)} — ${ui.fmtDate(last)}`;
  return ui.fmtDate(from);
}

// Границы периода из состояния панели: { kind, date, until } → { from, to } (to не входит).
export const statePeriod = (state, calc) => calc.periodRange(state.kind, state.date, state.until);

// state: { kind, date: 'ГГГГ-ММ-ДД', until: 'ГГГГ-ММ-ДД' (только для «Период») }. Возвращает разметку панели.
// «Период» — свои даты «с … по …» (например, с 1 по 10 число); стрелки сдвигают его на его же длину.
// all: true — ещё кнопка «Всё время» (без дат и стрелок), как в «Продажах».
export function periodBar(state, ui, { all = false } = {}) {
  const kinds = all ? [...KINDS, ['all', 'Всё время']] : KINDS;
  const dates = state.kind === 'range'
    ? `<label class="per-lbl">с <input type="date" data-perdate value="${ui.esc(state.date)}" aria-label="Период с"></label>
      <label class="per-lbl">по <input type="date" data-peruntil value="${ui.esc(state.until || state.date)}" aria-label="Период по"></label>`
    : `<input type="date" data-perdate value="${ui.esc(state.date)}" aria-label="Дата">`;
  return `<span class="per-kinds">${kinds.map(([k, t]) =>
    `<button type="button" class="chip btnlike${state.kind === k ? ' on' : ''}" data-kind="${k}" aria-pressed="${state.kind === k}">${t}</button>`).join('')}</span>
    ${state.kind === 'all' ? '' : `<span class="per-nav"><button type="button" class="btn sm ghost" data-shift="-1" aria-label="Назад">←</button>
    ${dates}
    <button type="button" class="btn sm ghost" data-shift="1" aria-label="Вперёд">→</button></span>`}`;
}

// Переход на «Период» начинается с того, что было на экране: «Месяц октябрь» → с 01.10 по 31.10.
export function setKind(state, kind, { ui, calc }) {
  if (kind === 'range' && state.kind !== 'range') {
    const { from, to } = statePeriod(state, calc);
    state.date = ui.toInputDate(from);
    state.until = ui.toInputDate(new Date(to.getTime() - 86400000));
  }
  state.kind = kind;
}

export function shiftPeriod(state, step, { ui, calc }) {
  if (state.kind === 'range') {
    const [a, b] = calc.rangeShift(state.date, state.until, step);
    state.date = ui.toInputDate(a);
    state.until = ui.toInputDate(b);
  } else state.date = ui.toInputDate(calc.periodShift(state.kind, state.date, step));
}

export function bindPeriod(el, state, ctx, rerender) {
  el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { setKind(state, b.dataset.kind, ctx); rerender(); }));
  el.querySelectorAll('[data-shift]').forEach((b) => b.addEventListener('click', () => { shiftPeriod(state, Number(b.dataset.shift), ctx); rerender(); }));
  el.querySelector('[data-perdate]')?.addEventListener('change', (e) => { if (e.target.value) { state.date = e.target.value; rerender(); } });
  el.querySelector('[data-peruntil]')?.addEventListener('change', (e) => { if (e.target.value) { state.until = e.target.value; rerender(); } });
}

// Ставки точек из points.rate (владелец их меняет): «пр-т Притомский 31к2 — 40%, …».
export const ratesText = (store) => [...store.data.points].sort((a, b) => (a.sort || 0) - (b.sort || 0))
  .map((p) => `${p.name} — ${toPct(p.rate)}%`).join(', ');

export const ownerName = (store) => {
  const o = store.data.users.find((u) => u.role === 'owner');
  return o && o.name ? `владельца (${o.name})` : 'владельца';
};

// ---------- выгрузка в Excel ----------

// Листы книги Excel по одному результату calc.finance: сводка, мастера, расходы, источники
// и (если переданы) выданные заказы периода. meta: { period, point, owner, orders, data } — подписи и заказы.
export function financeSheets(f, { period = '', point = '', owner = 'Доля владельца', orders = null, data = null } = {}) {
  const subtitle = `${period} · ${point}${f.closed ? ' · месяц закрыт, цифры из снимка' : ''}`;
  const neg = (v) => (v < 0 ? { v, tone: 'bad' } : v);
  const int = (v) => ({ v, type: 'int' });
  const sheets = [{
    name: 'Сводка',
    title: `Финансы — ${period}`,
    subtitle,
    columns: [{ title: 'Показатель', type: 'text', width: 34 }, { title: 'Сумма', type: 'money', width: 16 }],
    filter: false,
    rows: [
      ['Оборот (все поступившие деньги)', f.turnover],
      ['Прибыль ремонтов', neg(f.repairsProfit)],
      ['Прибыль продаж', neg(f.salesProfit)],
      ['Расходы', f.expenses],
      ['Расходы на гарантию', f.warrantyCost || 0],
      ['Гарантийных заказов', int(f.warrantyCount || 0)],
      ['ЗП мастеров', f.staffPayTotal],
      [{ v: 'Общая прибыль', bold: true }, { v: f.profitTotal, bold: true, tone: f.profitTotal < 0 ? 'bad' : 'ok' }],
      [{ v: owner, bold: true }, { v: f.ownerShare, bold: true, tone: f.ownerShare < 0 ? 'bad' : undefined }],
      ['Ремонтов выдано', int(f.repairs)],
      ['Средний чек', f.avgCheck],
    ],
  }, {
    name: 'Мастера',
    title: `Зарплата мастеров — ${period}`,
    subtitle,
    columns: [{ title: 'Мастер', type: 'text', width: 24 }, { title: 'Ремонтов', type: 'int', width: 11 }, { title: 'Гарантий', type: 'int', width: 11 },
      { title: 'Начислено', type: 'money', width: 14 }, { title: 'Штрафы', type: 'money', width: 12 }, { title: 'Выплачено', type: 'money', width: 14 },
      { title: 'К выплате', type: 'money', width: 14 }],
    rows: (f.masters || []).map((m) => [m.name, m.repairs, m.warranties || 0, m.accrued, m.fines ? { v: m.fines, tone: 'bad' } : 0, m.paid,
      { v: m.due, bold: true, tone: m.due < 0 ? 'bad' : undefined }]),
    total: 'Итого',
  }, {
    name: 'Расходы',
    title: `Расходы по категориям — ${period}`,
    subtitle,
    columns: [{ title: 'Категория', type: 'text', width: 30 }, { title: 'Сумма', type: 'money', width: 16 }],
    rows: (f.expensesByCategory || []).map(([c, v]) => [c, v]),
    total: 'Итого',
  }, {
    name: 'Источники',
    title: `Откуда клиенты — ${period}`,
    subtitle,
    columns: [{ title: 'Источник', type: 'text', width: 22 }, { title: 'Новых заказов', type: 'int', width: 14 }, { title: 'Выдано', type: 'int', width: 11 },
      { title: 'Оборот', type: 'money', width: 14 }, { title: 'Прибыль', type: 'money', width: 14 }, { title: 'Средний чек', type: 'money', width: 14 }],
    rows: (f.bySource || []).map((r) => [r.source, r.newOrders, r.issued, r.turnover, neg(r.profit), r.avgCheck]),
    total: 'Итого',
    noTotal: [5],
  }];
  if (orders && data) sheets.push({ ...ordersSheet(orders, data, { subtitle }), name: 'Выданные заказы', title: `Выданные заказы — ${period}` });
  return sheets;
}

// ---------- экран ----------

const state = { kind: 'month', date: '', until: '', point: '' };

export default {
  id: 'finance',
  title: 'Финансы',
  render(el, ctx) {
    const { store, ui, calc } = ctx;
    const { esc, money } = ui;
    if (!state.date) state.date = ui.today();
    const points = [...store.data.points].sort((a, b) => (a.sort || 0) - (b.sort || 0));
    if (state.point && !points.some((p) => p.id === state.point)) state.point = '';
    const { from, to } = calc.periodRange(state.kind, state.date, state.until);
    const f = calc.finance({ data: store.data, pointId: state.point, from, to });
    const owner = store.isOwner;
    const oName = ownerName(store);
    const card = (l, v, cls = '') => `<div class="card"><div class="l">${esc(l)}</div><div class="v ${cls}">${v}</div></div>`;
    const sign = (v) => (v < 0 ? 'neg' : '');
    const period = periodTitle(state.kind, from, to, ui);
    const pointLabel = state.point ? ui.pointName(state.point) : 'все точки';

    // Закрытие месяца: только вид «Месяц», только владелец, только прошедший месяц (по UTC+7, как на сервере).
    const mKey = state.kind === 'month' ? calc.monthKey(new Date((from.getTime() + to.getTime()) / 2)) : '';
    const mClose = mKey ? store.data.month_closes.find((x) => x.month === mKey) : null;
    const canClose = owner && mKey && !mClose && mKey < calc.monthKey(new Date());
    const closeInfo = mClose ? `<span class="chip fin-closed">Месяц закрыт</span>
      <span class="muted small">${esc(ui.fmtDateTime(mClose.at || mClose.created))}${mClose.closedBy ? ', ' + esc(ui.userName(mClose.closedBy)) : ''}
      — цифры из снимка на момент закрытия; денежные изменения месяца запрещены.</span>` : '';
    const srcRows = (f.bySource || []).map((r) => `<tr><td>${esc(r.source)}</td><td class="num">${r.newOrders}</td><td class="num">${r.issued}</td>
      <td class="num">${money(r.turnover)}</td><td class="num ${sign(r.profit)}"><b>${money(r.profit)}</b></td><td class="num">${money(r.avgCheck)}</td></tr>`).join('');

    const catList = f.expensesByCategory;
    const catMax = Math.max(1, ...catList.map((x) => x[1]));

    const masterRows = f.masters.map((m) => {
      const isOwn = m.userId && calc.isOwner(m.userId, store.data);
      return `<tr><td>${esc(m.name)}${isOwn ? ' <span class="chip accent">владелец</span>' : ''}</td>
        <td class="num">${m.repairs}</td><td class="num">${m.warranties || '—'}</td><td class="num">${money(m.accrued)}</td><td class="num">${m.fines ? money(m.fines) : '—'}</td>
        <td class="num">${m.paid ? money(m.paid) : '—'}</td><td class="num ${sign(m.due)}"><b>${money(m.due)}</b></td></tr>`;
    }).join('');

    const fines = store.data.fines.filter((x) => calc.inPeriod(x.date, from, to))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const fineRows = fines.map((x) => `<tr><td>${esc(ui.fmtDate(x.date))}</td><td>${esc(x.user ? ui.userName(x.user) : (x.userName || '—'))}</td>
      <td>${esc(x.reason || '')}</td><td class="num">${money(x.amount)}</td>
      ${owner ? `<td><button class="del" data-delfine="${esc(x.id)}" title="Удалить штраф" aria-label="Удалить штраф">×</button></td>` : ''}</tr>`).join('');
    const staff = store.data.users.filter((u) => u.active !== false && u.role !== 'owner')
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));

    el.innerHTML = `
      <div class="head"><h2>Финансы</h2></div>
      <div class="toolbar fin-bar">
        ${periodBar(state, ui)}
        <select id="finPoint" aria-label="Точка"><option value="">Все точки</option>${ui.options(points, state.point)}</select>
        <span class="fin-acts">
          <button type="button" class="btn sm ghost" id="finCsv" title="Таблица Excel: сводка, мастера, расходы, источники и выданные заказы за период">Скачать в Excel</button>
          ${canClose ? '<button type="button" class="btn sm" id="finClose">Закрыть месяц</button>' : ''}
          ${owner && mClose ? '<button type="button" class="btn sm ghost" id="finOpen">Открыть месяц</button>' : ''}
        </span>
      </div>
      <p class="fin-period">${esc(period)} · ${esc(pointLabel)}</p>
      ${closeInfo ? `<p class="fin-closeinfo">${closeInfo}</p>` : ''}
      <div class="cards">
        ${card('Оборот', money(f.turnover))}
        ${card('Прибыль ремонтов', money(f.repairsProfit), sign(f.repairsProfit))}
        ${card('Прибыль продаж', money(f.salesProfit), sign(f.salesProfit))}
        ${card('Расходы', money(f.expenses))}
        ${card(`Расходы на гарантию${f.warrantyCount ? ` (${f.warrantyCount})` : ''}`, money(f.warrantyCost || 0), f.warrantyCost ? 'neg' : '')}
        ${card('ЗП мастеров', money(f.staffPayTotal))}
        ${card('Общая прибыль', money(f.profitTotal), sign(f.profitTotal))}
        ${card('Доля ' + oName, money(f.ownerShare), sign(f.ownerShare))}
        ${card('Ремонтов выдано', f.repairs)}
        ${card('Средний чек', money(f.avgCheck))}
      </div>
      <p class="muted small fin-hint">Оборот — все поступившие деньги (оплаты заказов + продажи). Прибыль = цена − запчасти − курьер по выданным + прибыль продаж − расходы точки − расходы на гарантию (запчасти и курьер гарантийных заказов; цена у них 0, мастеру 0 ₽).
        Доля ${esc(oName)} = прибыль − ЗП мастеров − процент продавцам. <a href="#help">Как считается — в «Помощи»</a></p>

      <div class="sect">
        <h3>Мастера</h3>
        ${f.masters.length ? `<div class="tw"><table>
          <thead><tr><th>Мастер</th><th class="num">Ремонтов</th><th class="num" title="Гарантийные возвраты по ремонтам мастера (по дате приёма гарантии)">Гарантий</th><th class="num">Начислено</th><th class="num">Штрафы</th><th class="num">Выплачено</th><th class="num">К выплате</th></tr></thead>
          <tbody>${masterRows}</tbody></table></div>` : '<p class="empty">За этот период ремонтов и начислений нет.</p>'}
        <p class="muted small">Начислено = max(0, прибыль заказа) × ставка точки (${esc(ratesText(store))}) + процент с продаж; по ремонтам ${esc(oName)} начислено 0 — вся прибыль его.
          К выплате = начислено − штрафы − выплачено (ЗП в кассе). Гарантий — сколько заказов этого мастера вернулись по гарантии за период.${state.point ? ' <b>Штрафы — по всем точкам.</b>' : ''}</p>
      </div>

      <div class="sect">
        <h3>Откуда клиенты</h3>
        ${srcRows ? `<div class="tw"><table>
          <thead><tr><th>Источник</th><th class="num">Новых заказов</th><th class="num">Выдано</th><th class="num">Оборот</th><th class="num">Прибыль</th><th class="num">Средний чек</th></tr></thead>
          <tbody>${srcRows}</tbody></table></div>` : '<p class="empty">За этот период заказов нет.</p>'}
        <p class="muted small">Источник — поле «Рекламный источник» в заказе (или у клиента). Новых — принято за период, выдано и деньги — по выданным за период; гарантийные не учитываются. Сортировка по прибыли.</p>
      </div>

      <div class="two">
        <div class="sect">
          <h3>Расходы по категориям</h3>
          ${catList.length ? catList.map(([k, v]) => `<div class="bar"><span class="n">${esc(k)}</span><span class="t"><i style="width:${Math.round((v / catMax) * 100)}%"></i></span><span class="x">${money(v)}</span></div>`).join('')
            : '<p class="empty">Расходов за период нет. Вносятся в «Кассе» — <a href="#cash">перейти</a></p>'}
        </div>
        <div class="sect">
          <h3>Штрафы</h3>
          ${owner ? `<form class="row fin-fine" id="fineForm" novalidate>
            <select name="user" aria-label="Сотрудник" required><option value="">Сотрудник…</option>${ui.options(staff, '', (u) => u.name || u.email)}</select>
            <input type="number" name="amount" min="1" step="1" placeholder="Сумма, ₽" aria-label="Сумма" required>
            <input name="reason" placeholder="Причина" aria-label="Причина" required>
            <input type="date" name="date" value="${esc(ui.today())}" aria-label="Дата" required>
            <button class="btn">Назначить</button>
          </form><p class="err" id="fineErr" hidden></p>` : ''}
          ${fines.length ? `<div class="tw"><table><thead><tr><th>Дата</th><th>Кому</th><th>Причина</th><th class="num">Сумма</th>${owner ? '<th></th>' : ''}</tr></thead><tbody>${fineRows}</tbody></table></div>`
            : '<p class="empty">Штрафов за период нет.</p>'}
          <p class="muted small">Штраф вычитается из «к выплате». Назначает и удаляет только владелец.</p>
        </div>
      </div>`;

    const rerender = () => this.render(el, { ...ctx, params: {} });
    bindPeriod(el, state, ctx, rerender);
    el.querySelector('#finPoint').addEventListener('change', (e) => { state.point = e.target.value; rerender(); });
    el.querySelector('#finCsv').addEventListener('click', () => {
      const slug = (state.point ? ui.pointName(state.point) : 'все точки').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
      const issued = store.data.orders.filter((o) => o.status === 'issued' && calc.inPeriod(o.issuedAt, from, to) && (!state.point || o.point === state.point))
        .sort((a, b) => String(a.issuedAt).localeCompare(String(b.issuedAt)));
      ui.downloadXlsx(`финансы-${state.kind === 'month' ? mKey : ui.toInputDate(from)}-${slug}`,
        financeSheets(f, { period, point: pointLabel, owner: 'Доля ' + oName, orders: issued, data: store.data }));
    });
    if (!owner) return;

    el.querySelector('#finClose')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!(await ui.confirmDlg(`Закрыть ${period}? Зарплаты, штрафы, выплаты и итоги месяца зафиксируются, а заказы, выданные в этом месяце, нельзя будет изменить по деньгам. Открыть месяц обратно можно здесь же.`, { ok: 'Закрыть месяц', danger: false }))) return;
      try {
        await ui.busy(btn, store.create('month_closes', { month: mKey, snapshot: calc.monthSnapshot(store.data, mKey) }));
        ui.toast('Месяц закрыт');
        rerender();
      } catch (err) { ui.showError(err); }
    });
    el.querySelector('#finOpen')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!(await ui.confirmDlg(`Открыть ${period}? Цифры месяца снова будут считаться по текущим данным (и текущим ставкам), изменения по деньгам станут разрешены.`, { ok: 'Открыть месяц' }))) return;
      try {
        await ui.busy(btn, store.remove('month_closes', mClose.id));
        ui.toast('Месяц открыт');
        rerender();
      } catch (err) { ui.showError(err); }
    });

    const form = el.querySelector('#fineForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = ui.formData(form);
      const errBox = el.querySelector('#fineErr');
      const fail = (t) => { errBox.textContent = t; errBox.hidden = false; };
      if (!d.user) return fail('Выберите сотрудника.');
      if (!(d.amount > 0)) return fail('Укажите сумму больше нуля.');
      if (!d.reason) return fail('Укажите причину.');
      if (!d.date) return fail('Укажите дату.');
      errBox.hidden = true;
      try {
        await ui.busy(form.querySelector('button'), store.create('fines', {
          user: d.user, userName: ui.userName(d.user), amount: Math.round(d.amount), reason: d.reason, date: ui.fromInputDate(d.date) }));
        ui.toast('Штраф назначен');
        rerender();
      } catch (err) { ui.showError(err); }
    });
    el.querySelectorAll('[data-delfine]').forEach((b) => b.addEventListener('click', async () => {
      const x = store.data.fines.find((r) => r.id === b.dataset.delfine);
      if (!x) return;
      if (!(await ui.confirmDlg(`Удалить штраф ${money(x.amount)} (${x.user ? ui.userName(x.user) : x.userName})?`, { ok: 'Удалить' }))) return;
      try {
        await ui.busy(b, store.remove('fines', x.id));
        ui.toast('Штраф удалён');
      } catch (err) { ui.showError(err); }
    }));
  },
};
