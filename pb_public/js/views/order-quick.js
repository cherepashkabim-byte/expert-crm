// Окно «Быстрый заказ» (наклейка плёнки/стекла): панель справа, 5–6 полей, сразу «Выдан» и оплачен на всю цену.
// openQuick(ctx) — ctx вкладки (store, ui). Создание по шагам: клиент (если указан телефон) → заказ (status 'issued', quick: true)
// → запчасти со склада → оплата. Повтор после ошибки продолжает с невыполненного шага: созданное не создаётся второй раз.
import { PAY_METHODS, findClient } from './order-lib.js';
import { partPicker } from './order-parts.js';
import { userOptions } from './order-issue.js';
import { deviceSuggest } from './orders.js';

// Стандартный список услуг — пока владелец не сохранил свой (settings.quickServices, миграция 1760600000_quick_services.js).
export const QUICK_SERVICES = ['Наклейка плёнки', 'Наклейка защитного стекла', 'Чистка', 'Установка приложений'];

const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

// Услуги для выпадающего списка: из настроек, а если там пусто — стандартные.
export function quickServices(data) {
  const list = (data?.settings?.[0]?.quickServices || []);
  const own = Array.isArray(list) ? list.map(clean).filter(Boolean) : [];
  return own.length ? own : [...QUICK_SERVICES];
}

// Список с новой услугой в конце; такая уже есть (без учёта регистра) или пусто — список без изменений.
export function addService(list, name) {
  const n = clean(name);
  if (!n || list.some((x) => x.toLowerCase() === n.toLowerCase())) return [...list];
  return [...list, n];
}

// Шаги создания с продолжением после сбоя (чистая функция, без DOM): done = {client, order, paid} — что уже создано,
// staged — очередь запчастей (успешно созданная убирается из начала). Повтор с теми же done/staged создаёт только недостающее.
// api: {withClient, client() → id, order(clientId) → order, part(orderId, item), payment(order), onClient?(id), onOrder?(order), onPart?()}.
export async function runQuick(done, staged, api) {
  if (!done.order) {
    if (api.withClient && !done.client) {
      done.client = await api.client();
      api.onClient?.(done.client);
    }
    done.order = await api.order(done.client || '');
    api.onOrder?.(done.order);
  }
  while (staged.length) {
    await api.part(done.order.id, staged[0]);
    staged.shift();
    api.onPart?.();
  }
  if (!done.paid) {
    await api.payment(done.order);
    done.paid = true;
  }
  return done;
}

// onDone(order) — после успешного оформления и закрытия панели (список заказов перерисовывается сам, не дожидаясь realtime).
export function openQuick(ctx, onDone) {
  const { store, ui, calc } = ctx;
  const { esc } = ui;
  const me = store.me;
  const point0 = store.point || '';
  const staged = []; // запчасти к списанию: {part, name, qty, cost}
  const done = { client: '', order: null, paid: false }; // что уже создано — для повтора без дублей

  const box = ui.openModal(`<div class="dr-head"><h2>Быстрый заказ</h2><button type="button" class="x-close" data-close aria-label="Закрыть">×</button></div>
    <div class="dr-body"><form id="quickOrder" novalidate>
      <p class="muted small">Плёнка, стекло и другие быстрые работы: заказ сразу «Выдан» и оплачен на всю цену, гарантия 0.</p>
      <h3 class="dr-sect">Работа</h3>
      <div class="fields">
        <label class="full">Услуга *<span class="qk-svc"><input name="service" list="qkSvcList" autocomplete="off" placeholder="нажмите — выберите из списка или впишите свою">
          ${store.isOwner ? '<button type="button" class="btn ghost sm" data-svc-add hidden title="Добавить эту услугу в список">+ В список</button>' : ''}</span></label>
        <datalist id="qkSvcList">${quickServices(store.data).map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        <label>Марка<input name="brand" autocomplete="off" placeholder="Apple, Samsung, Xiaomi…"></label>
        <label>Модель<input name="model" autocomplete="off" placeholder="iPhone 13, редми ноут…"></label>
        <label>Цена, ₽ *<input name="price" type="number" min="0" step="1" inputmode="numeric"></label>
        <label>Оплата<select name="payMethod">${ui.options(PAY_METHODS, 'Нал')}</select></label>
        <label>Кто делал *<select name="repairedBy">${userOptions(store, ui, me.id)}</select></label>
        <label>Точка<select name="point">${point0 ? '' : '<option value="">— выберите —</option>'}${ui.options(store.data.points, point0)}</select></label>
      </div>
      <h3 class="dr-sect">Клиент — по желанию</h3>
      <div class="fields">
        <label>Телефон<input name="phone" type="tel" autocomplete="off" placeholder="8 900 123-45-67"></label>
        <label>ФИО<input name="name" autocomplete="off"></label>
      </div>
      <details class="qk-parts-box"><summary>Списать со склада — по желанию</summary>
        <div class="qk-parts"></div><div class="qk-picker"></div></details>
      <div class="err" hidden></div>
    </form></div>
    <div class="dr-foot"><button type="button" class="btn ghost" data-close>Отмена</button><button type="submit" class="btn" form="quickOrder">Оформить и выдать</button></div>`, null, { sticky: true, drawer: true,
    confirmClose: () => (dirty() ? 'Закрыть без сохранения? Введённое пропадёт' : '') });
  const form = box.querySelector('#quickOrder');
  const errBox = form.querySelector('.err');
  const snap = () => JSON.stringify([...form.elements].filter((x) => x.name).map((x) => x.value)) + staged.length;
  const state0 = snap();
  const dirty = () => !done.paid && (snap() !== state0 || !!done.order);

  // --- услуга: выпадающий список из настроек; новую владелец добавляет в список кнопкой «+ В список» ---
  const addBtn = form.querySelector('[data-svc-add]');
  const syncSvc = () => {
    if (!addBtn) return;
    const v = form.service.value;
    const list = quickServices(store.data);
    addBtn.hidden = addService(list, v).length === list.length; // пусто или уже в списке
  };
  form.service.addEventListener('input', syncSvc);
  addBtn?.addEventListener('click', async () => {
    const st = store.data.settings[0];
    if (!st) { ui.toast('Настройки ещё не загружены', 'error'); return; }
    const next = addService(quickServices(store.data), form.service.value);
    try {
      await ui.busy(addBtn, store.update('settings', st.id, { quickServices: next }));
      form.querySelector('#qkSvcList').innerHTML = next.map((t) => `<option value="${esc(t)}">`).join('');
      syncSvc();
      ui.toast(`«${next[next.length - 1]}» добавлена в список услуг`);
    } catch (err) { ui.showError(err); }
  });
  deviceSuggest(form, store, () => 'Телефон', () => form.price.focus());

  // --- запчасти: склад выбранной точки ---
  let picker = null;
  function drawStaged() {
    form.querySelector('.qk-parts').innerHTML = staged.length ? `<div class="tw"><table><thead><tr><th>Запчасть</th><th class="num">Кол-во</th><th class="num">Закуп</th><th></th></tr></thead><tbody>
      ${staged.map((p, i) => `<tr><td class="wrap">${esc(p.name || '—')}${p.part ? '' : ' <span class="muted small">(вручную)</span>'}</td><td class="num">${esc(p.qty)}</td>
        <td class="num">${ui.money(calc.partLineCost(p))}</td><td><button type="button" class="del" data-unstage="${i}" aria-label="Убрать">×</button></td></tr>`).join('')}
      </tbody></table></div>` : '';
  }
  function makePicker() {
    picker = partPicker(form.querySelector('.qk-picker'), {
      store, ui, pointId: form.point.value, onAdd: (item) => { staged.push(item); drawStaged(); },
    });
  }
  form.querySelector('.qk-parts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unstage]');
    if (b) { staged.splice(Number(b.dataset.unstage), 1); drawStaged(); }
  });
  form.point.addEventListener('change', () => {
    if (staged.some((p) => p.part)) {
      for (let i = staged.length - 1; i >= 0; i--) if (staged[i].part) staged.splice(i, 1);
      drawStaged();
      ui.toast('Точка изменилась — запчасти со склада убраны, выберите со склада этой точки', 'warn');
    }
    makePicker();
  });
  makePicker();
  const off = store.on((ch) => { if (box.isConnected && ch.collection === 'parts') picker?.refresh(); });
  document.addEventListener('ui:modalclose', off, { once: true });

  form.addEventListener('input', (e) => {
    if (!e.target.name) return;
    e.target.classList.remove('bad');
    e.target.parentElement.querySelector('.field-err')?.remove();
  });
  const fieldErr = (name, text) => {
    const el = form[name];
    el.classList.add('bad');
    if (!el.parentElement.querySelector('.field-err')) el.insertAdjacentHTML('afterend', `<div class="field-err">${esc(text)}</div>`);
  };

  let sending = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    errBox.hidden = true;
    const f = ui.formData(form);
    const errs = {};
    if (!f.service) errs.service = 'Укажите услугу';
    if (!(f.price > 0)) errs.price = 'Укажите цену';
    if (!f.repairedBy) errs.repairedBy = 'Укажите, кто делал';
    if (!f.point) errs.point = 'Выберите точку';
    if (f.phone && !ui.phoneValid(f.phone)) errs.phone = ui.PHONE_ERR;
    form.querySelectorAll('.field-err').forEach((x) => x.remove());
    form.querySelectorAll('.bad').forEach((x) => x.classList.remove('bad'));
    const keys = Object.keys(errs);
    if (keys.length && !done.order) {
      keys.forEach((k) => fieldErr(k, errs[k]));
      form[keys[0]].focus();
      return;
    }
    const btn = box.querySelector('[type=submit]');
    sending = true;
    try {
      await ui.busy(btn, () => runQuick(done, staged, {
        withClient: !!f.phone,
        async client() {
          let c = findClient(store.data.clients, f.phone);
          if (!c) c = await store.create('clients', { name: f.name, phone: ui.fmtPhone(f.phone) });
          else if (f.name && c.name !== f.name) c = await store.update('clients', c.id, { name: f.name });
          return c.id;
        },
        // Клиент уже создан: телефон и ФИО больше не меняются, иначе повтор привяжет заказ к старому клиенту с другим номером.
        onClient: () => { form.phone.disabled = true; form.name.disabled = true; },
        order: (clientId) => store.create('orders', {
          ...(clientId ? { client: clientId } : {}), point: f.point, deviceType: 'Телефон', brand: f.brand, model: f.model,
          fault: f.service, price: Math.round(f.price), payMethod: f.payMethod, warranty: 0,
          repairedBy: f.repairedBy, acceptedBy: me.id, status: 'issued', quick: true,
        }),
        // Заказ создан: поля, из которых он собран, больше не меняются — повтор доделает только запчасти и оплату.
        onOrder: () => {
          form.querySelectorAll('input, select').forEach((x) => { if (!x.closest('.qk-picker')) x.disabled = true; });
          if (addBtn) addBtn.disabled = true;
        },
        part: (orderId, p) => store.create('order_parts', { order: orderId, part: p.part || '', name: p.name, qty: p.qty, cost: p.cost }),
        onPart: drawStaged,
        payment: (o) => store.create('payments', { order: o.id, amount: Number(o.price) || 0, method: o.payMethod, by: me.id }),
      }));
      ui.closeModal();
      ui.toast(`Быстрый заказ № ${done.order.num} оформлен`);
      onDone?.(done.order);
    } catch (err) {
      errBox.textContent = (done.order ? `Заказ № ${done.order.num} создан, но не всё сохранилось — нажмите «Оформить и выдать» ещё раз. ` : '') + ui.errorText(err);
      errBox.hidden = false;
      errBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } finally { sending = false; }
  });
  form.service.focus();
}
