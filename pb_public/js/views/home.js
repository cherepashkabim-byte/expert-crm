// Вкладка «Главная»: сводка текущей точки на сегодня. Все цифры — calc.pointDashboard.
import { deviceText, leadsFor } from './order-lib.js';

const DAY = 86400000;

export default {
  id: 'home',
  title: 'Главная',
  render(el, { store, ui, calc, navigate }) {
    const { esc } = ui;
    const data = store.data;
    const pointId = store.point;
    const now = new Date();
    const d = calc.pointDashboard(data, pointId, now);
    const days = calc.forgotDays(data);
    const client = (o) => data.clients.find((c) => c.id === o.client) || {};

    const card = (label, value, cls = '') => `<div class="card${cls ? ' ' + cls : ''}"><div class="l">${esc(label)}</div><div class="v">${value}</div></div>`;
    const cards = [
      card('Принято сегодня', d.acceptedToday),
      card('Выдано сегодня', d.issuedToday),
      card('В работе', d.inWork),
      card('Ждёт запчасть', d.waitingParts),
      card('Готово к выдаче', d.ready),
      card('Просрочено', d.overdue.length, d.overdue.length ? 'home-bad' : ''),
      card('Забыто', d.forgotten.length, d.forgotten.length ? 'home-warn' : ''),
      card('Наличные в кассе', esc(ui.money(d.cashNow))),
      card('Оборот сегодня', esc(ui.money(d.turnoverToday))),
    ].join('');

    const orderRow = (o, extra) => {
      const c = client(o);
      return `<tr class="click" data-order="${esc(o.id)}">
        <td><b>${esc(o.num)}</b></td>
        <td>${esc(c.name || '—')}<div class="muted small">${esc(ui.fmtPhone(c.phone))}</div></td>
        <td>${esc(deviceText(o))}</td>${extra}</tr>`;
    };
    const table = (head, rows, empty) => (rows
      ? `<div class="tw"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="empty">${esc(empty)}</p>`);

    const overdue = d.overdue.map((o) => orderRow(o,
      `<td>${esc(ui.fmtDate(o.due))}</td><td class="home-red">Просрочено на ${calc.overdueDays(o, now)} дн.</td>`)).join('');
    const forgotten = d.forgotten.map((o) => {
      const since = o.readyAt || o.updated;
      const n = Math.floor((now - calc.toDate(since)) / DAY);
      return orderRow(o, `<td>${esc(ui.fmtDate(since))}</td><td class="home-amber">${n} дн.</td>`);
    }).join('');
    const low = d.lowStock.map((x) => `<tr class="click" data-stock="${x.kind}">
      <td>${esc(x.name || '—')}</td><td class="muted small">${x.kind === 'part' ? 'запчасть' : 'товар'}</td>
      <td class="num ${x.stock <= 0 ? 'home-red' : 'home-amber'}"><b>${x.stock}</b> шт.</td>${pointId ? '' : `<td class="muted small">${esc(ui.pointName(x.item.point))}</td>`}</tr>`).join('');

    // Заявки: мастеру — его точки, владельцу — все, в том числе общие (без точки) — leadsFor.
    const leads = leadsFor(data.leads, { owner: store.isOwner, point: pointId })
      .sort((a, b) => String(b.at || b.created).localeCompare(String(a.at || a.created)));
    const leadRows = leads.map((l) => `<tr class="click" data-lead="${esc(l.id)}">
      <td>${esc(ui.fmtDateTime(l.at || l.created))}</td>
      <td>${esc(l.name || '—')}<div class="muted small">${esc(ui.fmtPhone(l.phone))}</div></td>
      <td>${esc(l.device || '—')}<div class="muted small wrap">${esc(l.problem || '')}</div></td>
      <td class="muted small">${l.point ? esc(ui.pointName(l.point)) : 'не выбрана'}</td></tr>`).join('');

    const title = pointId ? esc(ui.pointName(pointId)) : 'все точки';
    el.innerHTML = `<div class="head"><h2>Главная</h2><span class="muted">${title} · ${esc(ui.fmtDate(now))}</span></div>
      <div class="cards home-cards">${cards}</div>
      ${leads.length ? `<section class="sect home-leads"><h3>Заявки с сайта: ${leads.length}</h3>
        <p class="muted small">Нажмите на заявку — откроются «Заказы», там заявку можно оформить в заказ или отклонить.</p>
        ${table(['Когда', 'Клиент', 'Устройство и проблема', 'Точка'], leadRows, '')}</section>` : ''}
      <div class="home-lists">
        <section class="sect"><h3>Просрочено: ${d.overdue.length}</h3>
          <p class="muted small">Срок прошёл, а заказ ещё не готов.</p>
          ${table(['№', 'Клиент', 'Устройство', 'Срок', ''], overdue, 'Просроченных заказов нет')}</section>
        <section class="sect"><h3>Забытые устройства: ${d.forgotten.length}</h3>
          <p class="muted small">Готовы дольше ${days} дн., клиент не забрал. Откройте заказ и нажмите «Напомнить клиенту».</p>
          ${table(['№', 'Клиент', 'Устройство', 'Готов с', 'Ждёт'], forgotten, 'Забытых устройств нет')}</section>
        <section class="sect"><h3>Заканчивается на складе${pointId ? ' этой точки' : ''}: ${d.lowStock.length}</h3>
          <p class="muted small">Остаток 1 шт. и меньше.</p>
          ${table(['Позиция', 'Вид', 'Остаток', ...(pointId ? [] : ['Точка'])], low, 'Всё в наличии')}</section>
      </div>`;

    el.querySelectorAll('[data-order]').forEach((tr) => tr.addEventListener('click', () => navigate('orders', { orderId: tr.dataset.order })));
    el.querySelectorAll('[data-stock]').forEach((tr) => tr.addEventListener('click', () => navigate('stock', { tab: tr.dataset.stock === 'part' ? 'parts' : 'products' })));
    el.querySelectorAll('[data-lead]').forEach((tr) => tr.addEventListener('click', () => navigate('orders', { leadId: tr.dataset.lead })));
  },
};
