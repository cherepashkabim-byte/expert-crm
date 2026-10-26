// Вкладка «Клиенты»: поиск по ФИО/телефону, карточка с историей ремонтов, «+ Заказ».
// navigate('clients', {clientId}) — карточка клиента.
import { SOURCES, clientOrders, historyTable, findClient } from './order-lib.js';
import { clientSummary } from '../calc.js';

const LIMIT = 300;
const state = { q: '', clientId: '' };

export default {
  id: 'clients',
  title: 'Клиенты',
  render(el, ctx) {
    const { store, params = {}, reason } = ctx;
    if (reason === 'navigate') state.clientId = params.clientId || '';
    const c = state.clientId && store.data.clients.find((x) => x.id === state.clientId);
    if (state.clientId && !c) state.clientId = '';
    if (c) renderCard(el, ctx, c); else renderList(el, ctx);
  },
};

// Сводка по клиенту: ремонтов, принёс, долг (calc.clientSummary — долг по всем не отказанным заказам) + сами заказы.
function summary(c, data) {
  return { orders: clientOrders(c.id, data), ...clientSummary(c.id, data) };
}

function renderList(el, ctx) {
  const { store, ui } = ctx;
  const { esc } = ui;
  const data = store.data;
  const s = state.q.trim().toLowerCase();
  const found = data.clients.filter((c) => !s || String(c.name || '').toLowerCase().includes(s)
    || ui.phoneMatch(c.phoneDigits || c.phone, s));
  const rows = found.map((c) => ({ c, ...summary(c, data) }))
    .sort((a, b) => String(b.last || b.c.created).localeCompare(String(a.last || a.c.created)));

  el.innerHTML = `<div class="head"><h2>Клиенты</h2><button class="btn" data-new>+ Заказ</button></div>
    <div class="toolbar"><input type="search" id="cliQ" placeholder="Поиск: ФИО или телефон" value="${esc(state.q)}" aria-label="Поиск клиентов">
      <span class="muted small">${data.clients.length} ${ui.plural(data.clients.length, 'клиент', 'клиента', 'клиентов')}</span></div>
    ${!data.clients.length ? '<p class="empty">Клиентов пока нет — они появятся при приёме заказа. <button class="btn" data-new>Создать заказ</button></p>'
      : !rows.length ? '<p class="empty">Никого не нашли <button class="btn ghost" data-reset>Сбросить поиск</button></p>'
      : `<div class="tw"><table><thead><tr><th>ФИО</th><th>Телефон</th><th>Источник</th><th class="num">Ремонтов</th><th class="num">Принёс</th><th class="num">Долг</th><th>Последний заказ</th></tr></thead><tbody>
        ${rows.slice(0, LIMIT).map((r) => `<tr class="click" data-client="${esc(r.c.id)}"><td>${esc(r.c.name || '—')}</td><td>${esc(ui.fmtPhone(r.c.phone) || '—')}</td>
          <td>${esc(r.c.source || '—')}</td><td class="num">${r.repairs}</td><td class="num">${ui.money(r.money)}</td>
          <td class="num ${r.debt ? 'neg' : ''}">${r.debt ? ui.money(r.debt) : '—'}</td><td>${esc(ui.fmtDate(r.last) || '—')}</td></tr>`).join('')}
        </tbody></table></div>
        ${rows.length > LIMIT ? `<p class="muted small">Показаны ${LIMIT} из ${rows.length}. Уточните поиск.</p>` : ''}`}`;

  const q = el.querySelector('#cliQ');
  q.addEventListener('input', () => {
    state.q = q.value;
    const pos = q.selectionStart;
    renderList(el, ctx);
    const nq = el.querySelector('#cliQ');
    nq.focus();
    nq.setSelectionRange(pos, pos);
  });
  el.querySelector('[data-reset]')?.addEventListener('click', () => { state.q = ''; renderList(el, ctx); });
  el.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => ctx.navigate('orders', { create: true })));
  el.querySelector('tbody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-client]');
    if (tr) ctx.navigate('clients', { clientId: tr.dataset.client });
  });
}

function renderCard(el, ctx, c) {
  const { store, ui } = ctx;
  const { esc } = ui;
  const data = store.data;
  const sm = summary(c, data);

  el.innerHTML = `<div class="head">
      <div><button type="button" class="btn ghost sm" data-back>← Все клиенты</button><h2>${esc(c.name || 'Без имени')}</h2>
        <div class="muted small">Клиент с ${esc(ui.fmtDate(c.created))}</div></div>
      <div class="actions"><button type="button" class="btn" data-neworder>+ Заказ</button>
        ${store.isOwner ? '<button type="button" class="btn danger" data-del>Удалить</button>' : ''}</div></div>
    <div class="cards">
      <div class="card"><div class="l">Ремонтов</div><div class="v">${sm.repairs}</div></div>
      <div class="card"><div class="l">Принёс денег</div><div class="v">${ui.money(sm.money)}</div></div>
      <div class="card"><div class="l">Долг</div><div class="v ${sm.debt ? 'neg' : ''}">${ui.money(sm.debt)}</div></div>
    </div>
    <section class="sect"><h3>Данные клиента</h3>
      <div class="fields">
        <label>ФИО<input data-cf="name" value="${esc(c.name || '')}"></label>
        <label>Телефон<input data-cf="phone" type="tel" value="${esc(ui.fmtPhone(c.phone))}"></label>
        <label>Рекламный источник<input data-cf="source" list="cliSrc" value="${esc(c.source || '')}"></label>
        <label class="full">Заметка<textarea data-cf="note" rows="2">${esc(c.note || '')}</textarea></label>
      </div>
      <datalist id="cliSrc">${SOURCES.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
    </section>
    <h3>История ремонтов</h3>
    ${sm.orders.length ? historyTable(sm.orders, data) : '<p class="empty">Заказов пока нет <button class="btn" data-neworder>Создать заказ</button></p>'}`;

  el.querySelector('[data-back]').addEventListener('click', () => ctx.navigate('clients'));
  el.querySelectorAll('[data-neworder]').forEach((b) => b.addEventListener('click', () => ctx.navigate('orders', { newForClient: c.id })));
  el.querySelector('tbody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-order]');
    if (tr) ctx.navigate('orders', { orderId: tr.dataset.order });
  });
  el.querySelector('[data-del]')?.addEventListener('click', async (e) => {
    const n = sm.orders.length;
    const text = n ? `Удалить клиента «${c.name}»? Его заказы (${n}) останутся, но без клиента.` : `Удалить клиента «${c.name}»?`;
    if (!(await ui.confirmDlg(text, { ok: 'Удалить' }))) return;
    try {
      await ui.busy(e.target, store.remove('clients', c.id));
      ui.toast('Клиент удалён');
      ctx.navigate('clients');
    } catch (err) { ui.showError(err); }
  });
  el.querySelectorAll('[data-cf]').forEach((input) => input.addEventListener('change', async () => {
    const f = input.dataset.cf;
    const v = input.value.trim();
    input.classList.remove('bad');
    input.parentElement.querySelector('.field-err')?.remove();
    const bad = (t) => { input.classList.add('bad'); input.insertAdjacentHTML('afterend', `<div class="field-err">${esc(t)}</div>`); };
    if (f === 'name' && !v) { bad('Укажите ФИО'); return; }
    if (f === 'phone') {
      if (!ui.phoneValid(v)) { bad(ui.PHONE_ERR); return; }
      const other = findClient(data.clients, v);
      if (other && other.id !== c.id) { bad(`Этот номер уже у клиента «${other.name}»`); return; }
    }
    try {
      await store.update('clients', c.id, { [f]: f === 'phone' ? ui.fmtPhone(v) : v });
      ui.toast('Сохранено');
    } catch (err) { bad(ui.errorText(err)); ui.showError(err); }
  }));
}
