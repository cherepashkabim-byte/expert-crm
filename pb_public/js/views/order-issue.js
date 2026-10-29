// Окно «Выдать клиенту»: сводка заказа и оплата остатка целиком (в долг не выдают) → статус «Выдан».
// Цену, мастера и гарантию спрашивает, только если их нет в заказе; запчасти и курьер правятся в карточке.
import { PAY_METHODS, blankHtml, blankVars } from './order-lib.js';

export function userOptions(store, ui, value, fallbackName = '') {
  const users = store.data.users.filter((u) => u.active !== false || u.id === value);
  const head = value ? '' : `<option value="">${ui.esc(fallbackName ? fallbackName + ' (без учётки)' : '— выберите —')}</option>`;
  return head + ui.options(users, value, (u) => u.name || u.email);
}

export function openIssue({ store, ui, calc }, orderId) {
  const { esc } = ui;
  const o0 = store.data.orders.find((x) => x.id === orderId);
  if (!o0) return;
  const me = store.me;
  const warranty = calc.isWarranty(o0); // гарантия: цена 0, оплата не принимается
  // Цена, гарантия, курьер, мастер и запчасти уже заполнены в карточке («Работы и материалы») — здесь их не повторяем.
  // Поле появляется, только если в заказе этого ещё нет.
  const needPrice = !warranty && !(Number(o0.price) > 0);
  const needMaster = !o0.repairedBy;
  const needWarranty = !(Number(o0.warranty) > 0);

  const box = ui.openModal(`<div class="head"><h2>Выдать клиенту · № ${esc(o0.num)}</h2><button type="button" class="x-close" data-close aria-label="Закрыть">×</button></div>
    <form id="issueForm" novalidate>
      ${warranty ? '<p class="ord-note">Гарантийный ремонт: цена 0 ₽, мастеру 0 ₽, оплата не принимается. Запчасти и курьер — расход сервиса на гарантию.</p>' : ''}
      ${needPrice || needMaster || needWarranty ? `<div class="fields">
        ${needPrice ? `<label>Точная цена ремонта, ₽ *<input type="number" name="price" min="0" step="1" value="${esc(Number(o0.approxPrice) || '')}"></label>` : ''}
        ${needMaster ? `<label>Кто сделал ремонт *<select name="repairedBy">${userOptions(store, ui, me.id)}</select></label>` : ''}
        ${needWarranty ? '<label>Гарантия, мес.<input type="number" name="warranty" min="0" step="1" value="3"></label>' : ''}
      </div>` : ''}
      <div class="iss-sum"></div>
      <p class="muted small">Изменить цену, запчасти, курьера или мастера — на вкладке «Работы и материалы».</p>
      ${warranty ? '' : `<div class="fields iss-pay"><label>К оплате, ₽<input type="number" name="pay" readonly tabindex="-1"></label>
        <label>Способ<select name="payMethod">${ui.options(PAY_METHODS, o0.payMethod || 'Нал')}</select></label></div>`}
      <div class="err" hidden></div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button>
        <button type="submit" class="btn">${warranty ? 'Выдать по гарантии' : 'Принять оплату и выдать'}</button></div>
    </form>`);
  const form = box.querySelector('#issueForm');
  const errBox = form.querySelector('.err');
  const order = () => store.data.orders.find((x) => x.id === orderId) || o0;

  // Заказ с тем, что введено в окне (цена/мастер, если их не было), — для итогов из calc.
  const sim = () => {
    const f = ui.formData(form);
    const o = { ...order() };
    if (needPrice) o.price = Number(f.price) || 0;
    if (needMaster) o.repairedBy = f.repairedBy;
    return o;
  };

  function refresh() {
    const o = sim();
    const data = store.data;
    const paid = calc.orderPaid(o, data);
    const toPay = calc.orderDebt(o, data);
    const pr = calc.profit(o, data);
    const pay = calc.masterPay(o, data);
    const note = warranty ? 'гарантия' : calc.hasManualPay(o) ? 'вручную' : calc.isOwner(o.repairedBy, data) ? 'владелец — вся прибыль его'
      : `${calc.toPct(calc.rate(o.point, data))}%`;
    // Та же разметка, что у итогов карточки (.oc-totals: пары dt/dd).
    const row = (t, v, cls = '') => `<dt class="${cls}">${t}</dt><dd class="${cls}">${v}</dd>`;
    form.querySelector('.iss-sum').innerHTML = `<dl class="oc-totals iss-totals">
      ${needPrice || warranty ? '' : row('Цена', ui.money(o.price))}
      ${needWarranty ? '' : row('Гарантия', `${esc(o.warranty)} мес.`)}
      ${needMaster ? '' : row('Мастер', esc(ui.userName(o.repairedBy)))}
      ${Number(o.courier) ? row('Курьер', ui.money(o.courier)) : ''}
      ${row('Запчасти', ui.money(calc.partsCost(o, data)))}
      ${warranty ? row('Расход на гарантию', ui.money(-calc.ownerFromOrder(o, data)), 'neg')
    : row('Прибыль', ui.money(pr), pr < 0 ? 'neg' : '') + row(`ЗП мастера <span class="muted">(${esc(note)})</span>`, ui.money(pay))
      + row('Внесено', ui.money(paid), 'pos') + row('К доплате', ui.money(toPay), toPay ? 'neg' : '')}
    </dl>`;
    if (form.pay) {
      form.pay.value = toPay || '';
      form.querySelector('.iss-pay').hidden = !toPay;
    }
  }

  form.addEventListener('input', (e) => {
    if (e.target.name) { e.target.classList.remove('bad'); e.target.parentElement.querySelector('.field-err')?.remove(); }
    if (e.target.name === 'price') refresh();
  });
  form.repairedBy?.addEventListener('change', refresh);

  const off = store.on((ch) => {
    if (!box.isConnected) return;
    if (['order_parts', 'payments', 'orders'].includes(ch.collection)) refresh();
  });
  document.addEventListener('ui:modalclose', off, { once: true });

  const fieldErr = (name, text) => {
    const el = form[name];
    el.classList.add('bad');
    if (!el.parentElement.querySelector('.field-err')) el.insertAdjacentHTML('afterend', `<div class="field-err">${esc(text)}</div>`);
  };

  let sending = false; // защита от повторной отправки, пока ждём ответ
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    errBox.hidden = true;
    const f = ui.formData(form);
    let bad = false;
    if (needPrice && !(f.price > 0)) { fieldErr('price', 'Укажите точную цену'); bad = true; }
    if (needMaster && !f.repairedBy) { fieldErr('repairedBy', 'Укажите, кто сделал ремонт'); bad = true; }
    if (bad) return;
    const btn = form.querySelector('[type=submit]');
    sending = true;
    try {
      await ui.busy(btn, async () => {
        // Весь остаток — одной оплатой. Считается по данным заново: после успешной оплаты остаток 0,
        // поэтому повтор после ошибки её не задублирует.
        const toPay = warranty ? 0 : calc.orderDebt(sim(), store.data);
        if (toPay > 0) await store.create('payments', { order: orderId, amount: Math.round(toPay), method: f.payMethod, by: me.id });
        await store.update('orders', orderId, {
          ...(needPrice ? { price: Math.round(f.price) } : {}),
          ...(needMaster ? { repairedBy: f.repairedBy } : {}),
          ...(needWarranty ? { warranty: Math.round(f.warranty || 0) } : {}),
          ...(toPay > 0 ? { payMethod: f.payMethod } : {}),
          status: 'issued',
        });
      });
      ui.closeModal();
      ui.toast(`Заказ № ${o0.num} выдан`);
      // Сразу предложить второй бланк — акт выдачи с гарантией (клиенту на руки).
      const tpl = (store.data.settings[0] || {}).templateIssue || '';
      const done = store.data.orders.find((x) => x.id === orderId);
      if (tpl.trim() && done && await ui.confirmDlg('Распечатать акт выдачи и гарантийный талон для клиента?', { ok: 'Печать', cancel: 'Не сейчас', danger: false })) {
        ui.printHtml(blankHtml(tpl, blankVars(done, store.data)));
      }
    } catch (err) {
      refresh();
      errBox.textContent = ui.errorText(err);
      errBox.hidden = false;
    } finally { sending = false; }
  });
  refresh();
}
