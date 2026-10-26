// Вкладка «Моя статистика»: ремонты и заработок текущего пользователя за период (все точки).
// Владелец может посмотреть статистику любого сотрудника. Цифры — из calc.masterStats / calc.masterPay.
import { periodBar, bindPeriod, periodTitle, ratesText } from './finance.js';
import { deviceText } from './order-lib.js';

const state = { kind: 'month', date: '', until: '', who: '', uid: '' };

export default {
  id: 'mystats',
  title: 'Моя статистика',
  render(el, ctx) {
    const { store, ui, calc } = ctx;
    const { esc, money } = ui;
    const me = store.me;
    if (!me) { el.innerHTML = '<div class="head"><h2>Моя статистика</h2></div><p class="empty">Войдите в CRM.</p>'; return; }
    if (!state.date) state.date = ui.today();
    const owner = store.isOwner;
    if (state.uid !== me.id) { state.uid = me.id; state.who = ''; }
    if (!owner || !store.data.users.some((u) => u.id === state.who)) state.who = me.id;
    const { from, to } = calc.periodRange(state.kind, state.date, state.until);
    const s = calc.masterStats(store.data, state.who, from, to);
    const self = state.who === me.id;
    const closed = !!calc.closedSnapshot(store.data, from, to);
    // Закрытый месяц: ЗП заказа — из снимка (orders[].pay); в старых снимках её нет — колонку скрываем.
    const showPay = !closed || s.orders.every((o) => o.pay !== undefined);
    const payOf = (o) => (closed ? o.pay : calc.masterPay(o, store.data));
    const isOwn = calc.isOwner(state.who, store.data);
    const card = (l, v, cls = '') => `<div class="card"><div class="l">${esc(l)}</div><div class="v ${cls}">${v}</div></div>`;

    const orders = [...s.orders].sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
    const orderRows = orders.map((o) => {
      const pr = calc.profit(o, store.data);
      return `<tr class="click" data-order="${esc(o.id)}"><td>№ ${esc(o.num)}</td><td>${esc(ui.fmtDate(o.issuedAt))}</td>
        <td>${esc(deviceText(o))}</td><td>${esc(ui.pointName(o.point))}</td>
        <td class="num">${money(o.price)}</td><td class="num ${pr < 0 ? 'neg' : ''}">${money(pr)}</td>
        ${showPay ? `<td class="num"><b>${money(payOf(o))}</b>${calc.hasManualPay(o) ? ' <span class="muted small" title="Сумма задана вручную">вручную</span>' : ''}</td>` : ''}</tr>`;
    }).join('');
    const saleRows = s.sales.map((x) => {
      const p = store.data.products.find((r) => r.id === x.product);
      return `<tr><td>${esc(ui.fmtDate(x.at))}</td><td>${esc(p ? p.name : '—')}</td><td class="num">${esc(x.qty)}</td>
        <td class="num">${money(calc.saleProfit(x))}</td><td class="num"><b>${money(calc.sellerPay(x, store.data))}</b></td></tr>`;
    }).join('');
    const fines = [...s.fineList].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const staff = [...store.data.users].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));

    el.innerHTML = `
      <div class="head"><h2>${self ? 'Моя статистика' : 'Статистика: ' + esc(s.name)}</h2></div>
      <div class="toolbar">
        ${periodBar(state, ui)}
        ${owner ? `<select id="msWho" aria-label="Сотрудник">${ui.options(staff, state.who, (u) => (u.name || u.email) + (u.id === me.id ? ' (я)' : ''))}</select>` : ''}
      </div>
      <p class="ms-period">${esc(periodTitle(state.kind, from, to, ui))} · все точки${closed ? ' <span class="chip ms-closed">Месяц закрыт</span>' : ''}</p>
      <div class="cards">
        ${card('Ремонтов', s.repairs)}
        ${card('Гарантийных возвратов', s.warranties || 0, s.warranties ? 'neg' : '')}
        ${card('Прибыль с них', money(s.profit), s.profit < 0 ? 'neg' : '')}
        ${card('Начислено', money(s.accrued))}
        ${card('Штрафы', money(s.fines))}
        ${card('Выплачено', money(s.paid))}
        ${card('К выплате', money(s.due), s.due < 0 ? 'neg' : '')}
      </div>
      <p class="muted small">${isOwn ? 'По вашим ремонтам ЗП не начисляется — вся прибыль ваша (видна в «Финансах» как доля владельца).'
        : `ЗП = max(0, цена − запчасти − курьер) × ставка точки (${closed ? 'на момент закрытия месяца' : esc(ratesText(store))}) + процент с продаж. К выплате = начислено − штрафы − выплачено.`}
${closed ? ' Месяц закрыт: итоги в карточках — из снимка на момент закрытия.' : ''}
        Гарантийные возвраты — сколько ваших ремонтов вернулись по гарантии (по дате приёма гарантии).
        <a href="#help">Подробнее в «Помощи»</a></p>

      <h3>Выданные заказы</h3>
      ${orders.length ? `<div class="tw"><table><thead><tr><th>Заказ</th><th>Выдан</th><th>Устройство</th><th>Точка</th><th class="num">Цена</th><th class="num">Прибыль</th>${showPay ? '<th class="num">ЗП</th>' : ''}</tr></thead>
        <tbody>${orderRows}</tbody></table></div>${showPay ? '' : '<p class="muted small">ЗП по заказам: из снимка недоступно (месяц закрыт до обновления CRM). Итог «Начислено» — из снимка.</p>'}` : '<p class="empty">За этот период выданных заказов нет.</p>'}
      ${s.sales.length ? `<h3>Продажи</h3><div class="tw"><table><thead><tr><th>Дата</th><th>Товар</th><th class="num">Кол-во</th><th class="num">Прибыль</th><th class="num">Процент</th></tr></thead>
        <tbody>${saleRows}</tbody></table></div>` : ''}
      ${fines.length ? `<h3>Штрафы</h3><div class="tw"><table><thead><tr><th>Дата</th><th>Причина</th><th class="num">Сумма</th></tr></thead><tbody>
        ${fines.map((f) => `<tr><td>${esc(ui.fmtDate(f.date))}</td><td>${esc(f.reason || '')}</td><td class="num">${money(f.amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;

    const rerender = () => this.render(el, { ...ctx, params: {} });
    bindPeriod(el, state, ctx, rerender);
    el.querySelector('#msWho')?.addEventListener('change', (e) => { state.who = e.target.value; rerender(); });
    el.querySelectorAll('[data-order]').forEach((tr) => tr.addEventListener('click', () => ctx.navigate('orders', { orderId: tr.dataset.order })));
  },
};
