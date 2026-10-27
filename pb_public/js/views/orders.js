// Вкладка «Заказы»: список с поиском и фильтрами, приём заказа, карточка (статусы, поля, запчасти, оплаты, журнал), бланк.
// Плюс: заявки с сайта, чипы «Просрочено»/«Забыто», фото, гарантия, «Напомнить клиенту», выгрузка в Excel.
// navigate('orders', {orderId}) — карточка; {newForClient: clientId} — форма приёма с клиентом; {create: true} — пустая форма.
import {
  STATUSES, STATUS_LABEL, SOURCES, DEVICE_TYPES, PAY_METHODS, findClient, personName, clientOrders,
  blankHtml, blankVars, statusChip, deviceText, historyTable, orderList,
  matchFilter, filterCounts, warrantyDraft, warrantyCheck, remindState, ordersSheet, leadDraft, leadsFor, timeline, FIELD_LABEL,
  peopleOptions, matchPeople, NO_MASTER,
} from './order-lib.js';
import { openQuick } from './order-quick.js';
import { saleDialog, renderSales } from './sales.js';
import { partPicker } from './order-parts.js';
import { normDevice, deviceName, orderDevice, searchModels, brandOptions, modelOptions, faultChips, COLORS, APPEARANCE, DEFAULT_APPEARANCE, toggleItem, hasItem, priceHint } from './order-hints.js';
import { openIssue, userOptions } from './order-issue.js';
import { plural, esc } from '../fmt.js';
import { articlesForOrder } from './kb-lib.js';

const LIMIT = 300;
// point — фильтр списка; следует за точкой из боковой панели (followed — за какой следовали в прошлый раз):
// по умолчанию видны заказы точки, где сейчас работаешь; «Все точки» или другую выбирают в фильтре до следующего переключения.
const state = {
  q: '', status: '', point: '', followed: null, orderId: '',
  acc: '', rep: '', view: 'repairs', // фильтры «Принял»/«Мастер» (ключи personKey, rep '-' — не назначен), режим «Ремонты | Продажи»
  // карточка: вкладка (на сессию), раскрыта ли история на узком экране, раскрытые события, прокрутка и кэш ленты, черновик комментария
  tab: 'info', histOpen: false, openEv: new Set(), histScroll: { id: '', top: 0 }, logCache: { id: '', log: [] }, draft: { id: '', text: '' },
};
const MAX_PHOTOS = 6;
const MAX_PHOTO_MB = 10;
// Заявки с сайта: из store.data.leads, а пока store их не грузит — своим запросом (не чаще раза в минуту).
const leadsCache = { list: null, at: 0, loading: false };
const REQUIRED = { deviceType: 'Укажите тип устройства', model: 'Укажите модель', fault: 'Опишите неисправность' };
const NUM_F = new Set(['approxPrice', 'price', 'warranty', 'courier']);
const DATE_F = new Set(['due']);

const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };


// Проверка выбранных фото: не больше free штук, каждое ≤ 10 МБ. Возвращает текст ошибки или ''.
function photosError(files, free) {
  if (files.length > free) return free > 0 ? `Можно добавить ещё ${free} фото (всего не больше ${MAX_PHOTOS})` : `Уже ${MAX_PHOTOS} фото — больше добавить нельзя`;
  const big = files.find((f) => f.size > MAX_PHOTO_MB * 1024 * 1024);
  if (big) return `Фото «${big.name}» больше ${MAX_PHOTO_MB} МБ`;
  const bad = files.find((f) => f.type && !f.type.startsWith('image/'));
  if (bad) return `«${bad.name}» — не фото`;
  return '';
}

// ---------- заявки с сайта ----------

function newLeads(store, onLoaded) {
  const who = { owner: store.isOwner, point: store.point };
  if (Array.isArray(store.data.leads)) return leadsFor(store.data.leads, who);
  if (!leadsCache.loading && Date.now() - leadsCache.at > 60000) {
    leadsCache.loading = true;
    store.request(() => store.pb.collection('leads').getFullList({ filter: 'status = "new"', sort: '-at' }))
      .then((r) => { leadsCache.list = r; onLoaded(); })
      .catch(() => { leadsCache.list = leadsCache.list || []; })
      .finally(() => { leadsCache.at = Date.now(); leadsCache.loading = false; });
  }
  return leadsFor(leadsCache.list, who);
}

async function updateLead(store, id, body) {
  if (Array.isArray(store.data.leads)) return store.update('leads', id, body);
  const rec = await store.request(() => store.pb.collection('leads').update(id, body));
  if (leadsCache.list) leadsCache.list = leadsCache.list.map((l) => (l.id === id ? rec : l));
  return rec;
}

function leadsBlock(leads, ui) {
  if (!leads.length) return '';
  const { esc } = ui;
  const items = leads.slice().sort((a, b) => String(b.at || b.created).localeCompare(String(a.at || a.created))).map((l) => `<div class="ord-lead">
      <div><b>${esc(l.name || '—')}</b> · <a href="tel:${esc(l.phone || '')}">${esc(ui.fmtPhone(l.phone) || '—')}</a>
        <span class="muted small">· ${esc(ui.fmtDateTime(l.at || l.created))}${l.point ? ' · ' + esc(ui.pointName(l.point)) : ''}</span>
        ${l.device ? `<div class="small">${esc(l.device)}</div>` : ''}${l.problem ? `<div class="muted small">${esc(l.problem)}</div>` : ''}</div>
      <div class="actions"><button type="button" class="btn sm" data-lead-ok="${esc(l.id)}">Оформить заказ</button>
        <button type="button" class="btn ghost sm" data-lead-no="${esc(l.id)}">Отклонить</button></div></div>`).join('');
  return `<details class="sect ord-leads" open><summary>Заявки с сайта: <b>${leads.length}</b></summary>${items}</details>`;
}

export default {
  id: 'orders',
  title: 'Заказы',
  render(el, ctx) {
    const { store, params = {}, reason } = ctx;
    if (reason === 'navigate') {
      state.orderId = params.orderId || '';
      if (params.view) state.view = params.view === 'sales' ? 'sales' : 'repairs';
      else if (params.orderId || params.create || params.newForClient || params.leadId) state.view = 'repairs';
    }
    const o = state.orderId && store.data.orders.find((x) => x.id === state.orderId);
    if (state.orderId && !o) state.orderId = '';
    if (o) renderCard(el, ctx, o); else renderList(el, ctx);
    if (reason === 'navigate' && (params.newForClient || params.create)) openCreate(ctx, params.newForClient || '');
    // {leadId} — с «Главной»: сразу форма приёма по этой заявке.
    if (reason === 'navigate' && params.leadId && !o) {
      const l = (store.data.leads || leadsCache.list || []).find((x) => x.id === params.leadId);
      if (l && l.status === 'new') openCreate(ctx, '', leadDraft(l));
    }
  },
};

// ---------- список ----------

// Кнопка «+ Новый» с меню: Заказ / Быстрый заказ / Продажа (открывается кликом и с клавиатуры — menus()).
const NEW_MENU = `<div class="oc-mwrap ord-new"><button type="button" class="btn" data-menu aria-haspopup="menu" aria-expanded="false">+ Новый ▾</button>
  <div class="oc-menu down" role="menu" hidden>
    <button type="button" role="menuitem" data-new="order">Заказ</button>
    <button type="button" role="menuitem" data-new="quick">Быстрый заказ <span class="muted small">плёнка, стекло</span></button>
    <button type="button" role="menuitem" data-new="sale">Продажа</button></div></div>`;

function bindNew(el, ctx) {
  menus(el);
  el.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.new;
    if (k === 'quick') openQuick(ctx, (o) => showCreated(el, ctx, o));
    else if (k === 'sale') saleDialog(ctx);
    else openCreate(ctx, '');
  }));
}

// Быстрый заказ оформлен: сразу перерисовать список (не ждать отложенной перерисовки app.js).
// Фильтры (этап, «Принял», «Мастер», поиск, точка) сбрасываются, только если прячут новый заказ, — и тогда тост.
// Точка меняется, только если фильтр стоял на другой конкретной точке; «Все точки» не сужаются.
function showCreated(el, ctx, o) {
  const { store, ui } = ctx;
  if (!o) return;
  const host = el.closest('#app') || el;
  if (!host.isConnected || state.orderId || location.hash.slice(1) !== 'orders') return; // ушли с «Заказов» — перерисует app.js
  const days = ctx.calc.forgotDays(store.data);
  const hides = {
    status: state.status && !(state.status === 'quick' ? o.quick : matchFilter(o, state.status, new Date(), days)),
    acc: state.acc && !matchPeople(o, { acc: state.acc }),
    rep: state.rep && !matchPeople(o, { rep: state.rep }),
    q: state.q.trim() && !orderList([o], store.data, { q: state.q }).rows.length,
    point: state.point && o.point && o.point !== state.point,
  };
  let reset = false;
  if (hides.status) { state.status = ''; reset = true; }
  if (hides.acc) { state.acc = ''; reset = true; }
  if (hides.rep) { state.rep = ''; reset = true; }
  if (hides.q) { state.q = ''; reset = true; }
  if (hides.point) { state.point = o.point; reset = true; }
  state.view = 'repairs';
  renderList(host, ctx);
  if (reset) ui.toast('Фильтр сброшен, чтобы показать новый заказ');
}

// Выпадающий список людей: «Принял: все (n)» / «Мастер: … · Не назначен (n)».
function peopleSelect(ui, label, attr, opts, cur, total) {
  // У выбранного человека — подпись списка, чтобы закрытый список читался «Мастер: Кирилл (3)».
  const opt = (key, name, n) => `<option value="${ui.esc(key)}"${cur === key ? ' selected' : ''}>${key && cur === key ? `${label}: ` : ''}${ui.esc(name)} (${n})</option>`;
  return `<select data-${attr} class="ord-psel${cur ? ' on' : ''}" aria-label="${label}">${opt('', `${label}: все`, total)}${opts.map((x) => opt(x.key, x.name, x.n)).join('')}</select>`;
}

function renderList(el, ctx) {
  const { store, ui } = ctx;
  const { esc } = ui;
  const data = store.data;
  const views = `<div class="ord-views" role="group" aria-label="Режим">${[['repairs', 'Ремонты'], ['sales', 'Продажи']]
    .map(([k, t]) => `<button type="button" class="chip btnlike${state.view === k ? ' on accent' : ''}" data-view="${k}" aria-pressed="${state.view === k}">${t}</button>`).join('')}</div>`;
  const bindViews = () => el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    if (state.view === b.dataset.view) return;
    state.view = b.dataset.view;
    renderList(el, ctx);
  }));
  if (state.view === 'sales') {
    // В «Продажах» своя кнопка «+ Продажа» (renderSales) — меню «+ Новый» здесь не нужно.
    el.innerHTML = `<div class="head"><h2>Заказы</h2>${views}</div><div class="ord-sales"></div>`;
    bindViews();
    renderSales(el.querySelector('.ord-sales'), ctx);
    return;
  }
  if (state.followed !== (store.point || '')) { state.followed = store.point || ''; state.point = state.followed; }
  if (state.point && !data.points.some((p) => p.id === state.point)) state.point = '';
  const { calc } = ctx;
  const now = new Date();
  const days = calc.forgotDays(data);
  const { rows: base, elsewhere } = orderList(data.orders, data, { point: state.point, q: state.q });
  // Фильтры складываются; число на чипе — по остальным активным фильтрам.
  const stageOk = (o) => (state.status === 'quick' ? !!o.quick : matchFilter(o, state.status, now, days));
  const byPeople = base.filter((o) => matchPeople(o, { acc: state.acc, rep: state.rep }));
  const counts = filterCounts(byPeople, now, days);
  const rows = byPeople.filter(stageOk).sort((a, b) => (Number(b.num) || 0) - (Number(a.num) || 0));
  const any = data.orders.length > 0;
  const quickN = byPeople.filter((o) => o.quick).length;
  const chips = [['', 'Все', byPeople.length], ...STATUSES.map(([k, t]) => [k, t, counts[k] || 0]),
    ['overdue', 'Просрочено', counts.overdue], ['forgotten', 'Забыто', counts.forgotten], ['quick', 'Быстрые', quickN]]
    .map(([k, t, n]) => `<button type="button" class="chip btnlike st-${k || 'all'}${state.status === k ? ' on' : ''}${n ? '' : ' zero'}" data-st="${k}" aria-pressed="${state.status === k}"${k === 'forgotten' ? ` title="«Готов» дольше ${days} дн."` : k === 'quick' ? ' title="Быстрые заказы: плёнка, стекло — сразу выданы"' : ''}>${esc(t)} <b>${n}</b></button>`).join('');
  // Люди: выбранный, у кого по остальным фильтрам 0 заказов, остаётся в ряду (чтобы его можно было снять).
  const people = (role, cur) => {
    const set = base.filter((o) => stageOk(o) && matchPeople(o, role === 'acc' ? { rep: state.rep } : { acc: state.acc }));
    const opts = peopleOptions(set, data, role);
    if (cur && !opts.some((x) => x.key === cur)) {
      const known = peopleOptions(data.orders, data, role).find((x) => x.key === cur);
      opts.push({ key: cur, name: known ? known.name : (cur === NO_MASTER ? 'Не назначен' : cur), n: 0 });
    }
    return { opts, total: set.length };
  };
  const acc = people('acc', state.acc);
  const rep = people('rep', state.rep);
  const leads = newLeads(store, () => { if (el.isConnected && !state.orderId) renderList(el, ctx); });

  const body = rows.slice(0, LIMIT).map((o) => {
    const c = data.clients.find((x) => x.id === o.client) || {};
    const price = calc.isWarranty(o) ? '<span class="muted">гарантия</span>'
      : Number(o.price) ? ui.money(o.price) : (Number(o.approxPrice) ? `<span class="muted">~${ui.money(o.approxPrice)}</span>` : '—');
    const late = calc.overdueDays(o, now);
    const forgot = calc.isForgotten(o, now, days);
    const marks = (late ? `<div class="ord-mark bad">просрочен ${late} дн.</div>` : '')
      + (forgot ? '<div class="ord-mark warn">забыт</div>' : '')
      + (calc.isWarranty(o) ? '<div class="ord-mark">гарантия</div>' : '')
      + (o.quick ? '<div class="ord-mark quick">быстрый</div>' : '');
    const master = personName(o.repairedBy, o.repairedName, data);
    const accName = personName(o.acceptedBy, o.acceptedName, data);
    return `<tr class="click${late ? ' ord-overdue' : ''}${forgot ? ' ord-forgot' : ''}" data-order="${esc(o.id)}">
      <td><b>${esc(o.num)}</b></td><td>${esc(ui.fmtDate(o.acceptedAt || o.created))}</td>
      <td>${esc(c.name || '—')}<div class="muted small">${esc(ui.fmtPhone(c.phone))}</div></td>
      <td>${esc(deviceText(o))}</td><td class="wrap ord-fault">${esc(o.fault || '—')}</td>
      <td>${statusChip(o.status)}${marks}</td><td class="num">${price}</td>
      <td class="ord-who">${master ? esc(master) : '<span class="muted">не назначен</span>'}${accName ? `<div class="muted small">принял: ${esc(accName)}</div>` : ''}</td>
      <td class="muted small">${esc(ui.pointName(o.point))}</td></tr>`;
  }).join('');

  const hint = elsewhere ? ` Найдено в других точках: ${elsewhere} — <button type="button" class="btn ghost sm" data-allpoints>показать все точки</button>` : '';
  el.innerHTML = `<div class="head"><h2>Заказы</h2>${views}<div class="actions">
      ${rows.length ? '<button type="button" class="btn ghost" data-csv title="Таблица Excel: заказы по текущему фильтру, с итогами">Скачать в Excel</button>' : ''}
      ${any ? NEW_MENU : ''}</div></div>
    ${leadsBlock(leads, ui)}
    <div class="toolbar">
      <input type="search" id="ordQ" placeholder="Поиск: №, ФИО, телефон, модель" value="${esc(state.q)}" aria-label="Поиск заказов">
      <select id="ordPoint" aria-label="Точка"><option value="">Все точки</option>${ui.options(data.points, state.point)}</select>
      ${any ? peopleSelect(ui, 'Принял', 'acc', acc.opts, state.acc, acc.total) + peopleSelect(ui, 'Мастер', 'rep', rep.opts, state.rep, rep.total) : ''}
    </div>
    <div class="toolbar ord-chips">${chips}</div>
    ${!any ? `<div class="empty ord-empty">Заказов пока нет ${NEW_MENU}</div>`
      : !base.length && state.point && !state.q.trim() ? `<p class="empty">На этой точке заказов пока нет. <button class="btn ghost" data-allpoints>Показать все точки</button></p>`
      : !rows.length ? `<p class="empty">По фильтру ничего не найдено.${hint} <button class="btn ghost" data-reset>Сбросить фильтр</button></p>`
      : `<div class="tw"><table class="ord-table"><thead><tr><th>№</th><th>Принят</th><th>Клиент</th><th>Устройство</th><th>Неисправность</th><th>Статус</th><th class="num">Цена</th><th>Мастер</th><th>Точка</th></tr></thead>
        <tbody>${body}</tbody></table></div>
        ${hint ? `<p class="muted small">${hint}</p>` : ''}
        ${rows.length > LIMIT ? `<p class="muted small">Показаны ${LIMIT} из ${rows.length}. Уточните поиск.</p>` : ''}`}`;

  const rerender = () => renderList(el, ctx);
  bindViews();
  bindNew(el, ctx);
  const q = el.querySelector('#ordQ');
  q.addEventListener('input', () => {
    state.q = q.value;
    const pos = q.selectionStart;
    rerender();
    const nq = el.querySelector('#ordQ');
    nq.focus();
    nq.setSelectionRange(pos, pos);
  });
  el.querySelector('#ordPoint').addEventListener('change', (e) => { state.point = e.target.value; rerender(); });
  el.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => { state.status = b.dataset.st; rerender(); }));
  el.querySelector('[data-acc]')?.addEventListener('change', (e) => { state.acc = e.target.value; rerender(); });
  el.querySelector('[data-rep]')?.addEventListener('change', (e) => { state.rep = e.target.value; rerender(); });
  el.querySelector('[data-reset]')?.addEventListener('click', () => {
    Object.assign(state, { q: '', status: '', acc: '', rep: '', point: store.point || '' });
    rerender();
  });
  el.querySelectorAll('[data-allpoints]').forEach((b) => b.addEventListener('click', () => { state.point = ''; rerender(); }));
  el.querySelector('[data-csv]')?.addEventListener('click', () => {
    const pname = (opts, key) => opts.find((x) => x.key === key)?.name || key;
    const stage = { overdue: 'Просрочено', forgotten: 'Забыто', quick: 'Быстрые' };
    const filter = [state.point ? ui.pointName(state.point) : 'все точки',
      state.status ? (STATUS_LABEL[state.status] || stage[state.status] || state.status) : '',
      state.acc ? `принял: ${pname(acc.opts, state.acc)}` : '',
      state.rep ? `мастер: ${state.rep === NO_MASTER ? 'не назначен' : pname(rep.opts, state.rep)}` : '',
      state.q ? `поиск «${state.q}»` : ''].filter(Boolean).join(' · ');
    ui.downloadXlsx(`заказы-${ui.today()}`, [ordersSheet(rows, data, { subtitle: `Выгружено ${ui.fmtDateTime(new Date())} · ${filter}` })]);
    ui.toast(`Выгружено заказов: ${rows.length}`);
  });
  el.querySelectorAll('[data-lead-ok]').forEach((b) => b.addEventListener('click', () => {
    const l = leads.find((x) => x.id === b.dataset.leadOk);
    if (l) openCreate(ctx, '', leadDraft(l));
  }));
  el.querySelectorAll('[data-lead-no]').forEach((b) => b.addEventListener('click', async () => {
    const l = leads.find((x) => x.id === b.dataset.leadNo);
    if (!l || !(await ui.confirmDlg(`Отклонить заявку «${l.name}»? Она пропадёт из списка.`, { ok: 'Отклонить' }))) return;
    try {
      await ui.busy(b, updateLead(store, l.id, { status: 'rejected' }));
      ui.toast('Заявка отклонена');
      rerender();
    } catch (err) { ui.showError(err); }
  }));
  el.querySelector('tbody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-order]');
    if (tr) ctx.navigate('orders', { orderId: tr.dataset.order });
  });
}

// ---------- приём заказа ----------

// preset — подстановка: заявка с сайта (leadDraft: name, phone, model, fault, point, source, lead)
// или гарантия (warrantyDraft: client, point, source, deviceType, model, color, warrantyOf, price 0).
function openCreate(ctx, clientId, preset = {}) {
  const { store, ui } = ctx;
  const { esc } = ui;
  const cid = clientId || preset.client || '';
  const pre = cid ? store.data.clients.find((c) => c.id === cid) : null;
  const me = store.me;
  const orig = preset.warrantyOf ? store.data.orders.find((x) => x.id === preset.warrantyOf) : null;
  const wch = orig ? warrantyCheck(orig) : null;
  const point = preset.point || store.point;
  const devType = preset.deviceType || 'Телефон';
  const dev0 = preset.model || preset.brand ? normDevice(preset.brand, preset.model) : { brand: '', model: '' };
  const devTypes = DEVICE_TYPES.includes(devType) ? DEVICE_TYPES : [devType, ...DEVICE_TYPES];
  const banner = orig ? `<p class="ord-note${wch.ok ? '' : ' warn'}">Гарантия по заказу № ${esc(orig.num)}: ${esc(wch.text)}${wch.ok ? '' : ' — заказ всё равно можно создать'}. Цена ремонта — 0 ₽.</p>`
    : preset.lead ? '<p class="ord-note">Заявка с сайта: проверьте данные и заполните недостающее.</p>' : '';
  const box = ui.openModal(`<div class="dr-head"><h2>${orig ? 'Гарантийный заказ' : 'Новый заказ'}</h2><button type="button" class="x-close" data-close aria-label="Закрыть">×</button></div>
    <div class="dr-body"><form id="newOrder" novalidate>${banner}
      <h3 class="dr-sect">Клиент</h3>
      <div class="fields">
        <label>Телефон *<input name="phone" type="tel" autocomplete="off" placeholder="8 900 123-45-67" value="${esc(ui.fmtPhone(pre?.phone || preset.phone))}"></label>
        <label>ФИО клиента *<input name="name" autocomplete="off" value="${esc(pre?.name || preset.name || '')}"></label>
        <label class="full">Рекламный источник<input name="source" list="ordSrc" autocomplete="off" value="${esc(preset.source || pre?.source || '')}" placeholder="выберите или впишите"></label>
      </div>
      <div class="ord-hist"></div>
      <h3 class="dr-sect">Устройство и неисправность</h3>
      <div class="fields">
        <div class="ord-same full" hidden></div>
        <label>Тип устройства *<select name="deviceType">${ui.options(devTypes, devType)}</select></label>
        <label>Марка<input name="brand" autocomplete="off" placeholder="Apple, Samsung, Xiaomi…" value="${esc(dev0.brand)}"></label>
        <label>Модель *<input name="model" autocomplete="off" placeholder="iPhone 13, айфон 11 про, редми ноут…" value="${esc(dev0.model)}"></label>
        <label>Цвет<input name="color" list="ordColor" autocomplete="off" placeholder="выберите или впишите" value="${esc(preset.color || '')}"></label>
        <label class="full">Внешний вид<input name="appearance" autocomplete="off" placeholder="нажмите — выберите из списка или впишите" value="${esc(preset.appearance ?? DEFAULT_APPEARANCE)}"></label>
        <label class="full">Неисправность *<textarea name="fault" rows="2" placeholder="нажмите — выберите из списка или опишите своими словами">${esc(preset.fault || '')}</textarea></label>
        ${orig ? '' : '<label class="full">Примерная цена, ₽<input name="approxPrice" type="number" min="0" step="1" inputmode="numeric"><span class="ord-price-hint" hidden></span></label>'}
      </div>
      <h3 class="dr-sect">Дополнительно</h3>
      <div class="fields">
        <label>Срок<input name="due" type="date" value="${esc(ui.toInputDate(addDays(2)))}"></label>
        <label>Принял<select name="acceptedBy">${userOptions(store, ui, me.id)}</select></label>
        <label>Мастер<select name="repairedBy">${masterOptions(store, ui, {})}</select></label>
        <label>Точка<select name="point">${point ? '' : '<option value="">— выберите —</option>'}${ui.options(store.data.points, point)}</select></label>
        <label class="full">Фото устройства (до ${MAX_PHOTOS})<input name="photos" type="file" accept="image/*" capture="environment" multiple></label>
        <label class="check full"><input type="checkbox" name="notifySms"> Сообщить по СМС, когда будет готов</label>
      </div>
      <datalist id="ordSrc">${SOURCES.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <datalist id="ordColor">${COLORS.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <div class="err" hidden></div>
    </form></div>
    <div class="dr-foot"><button type="button" class="btn ghost" data-close>Отмена</button><button type="submit" class="btn" form="newOrder">${orig ? 'Создать гарантийный заказ' : 'Создать заказ'}</button></div>`, null, { sticky: true, drawer: true,
    confirmClose: () => (formState(form) !== state0 ? 'Закрыть без сохранения? Введённое пропадёт' : '') });
  const form = box.querySelector('#newOrder');
  const errBox = form.querySelector('.err');
  const auto = { id: '', name: '', source: '' }; // что подставили сами — чтобы не затирать введённое руками

  // --- подсказки: марка → модели этой марки (по типу устройства), списки внешнего вида и неисправностей, обычная цена ---
  // Список неисправностей берётся по текущему типу устройства при каждом открытии — смена типа меняет и его.
  multiPick(form.appearance, () => APPEARANCE);
  multiPick(form.fault, () => faultChips(form.deviceType.value));
  function onPriceHint() {
    const hint = form.querySelector('.ord-price-hint');
    if (!hint) return;
    const h = priceHint(store.data.orders, form.model.value, form.fault.value, form.brand.value);
    hint.hidden = !h;
    if (!h) { hint.innerHTML = ''; return; }
    const range = h.min !== h.max ? `от ${ui.money(h.min)} до ${ui.money(h.max)}, ` : '';
    hint.title = `Такой же ремонт раньше: ${range}${h.n} ${plural(h.n, 'заказ', 'заказа', 'заказов')}`;
    hint.innerHTML = `<button type="button" class="btn sm ghost" data-useprice="${h.price}">Обычно ${ui.money(h.price)} — подставить</button>`;
  }
  deviceSuggest(form, store, () => form.deviceType.value, () => form.color.focus());
  form.model.addEventListener('input', onPriceHint);
  form.brand.addEventListener('input', onPriceHint);
  form.fault.addEventListener('input', onPriceHint);
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-useprice]');
    if (b) form.approxPrice.value = b.dataset.useprice;
  });
  onPriceHint();

  // Постоянный клиент: «Тот же аппарат» подставляет устройство из его последнего заказа.
  function showSame(c) {
    const same = form.querySelector('.ord-same');
    const last = c && !preset.model ? clientOrders(c.id, store.data).find((o) => o.model) : null;
    same.hidden = !last;
    if (!last) { same.innerHTML = ''; return; }
    const ld = normDevice(last.brand, last.model);
    const what = [last.deviceType, deviceName(ld), last.color].filter(Boolean).join(', ');
    same.innerHTML = `<button type="button" class="btn sm ghost" data-same>Тот же аппарат, что в прошлый раз: ${esc(what)}</button>`;
    same.querySelector('[data-same]').addEventListener('click', () => {
      if (last.deviceType) {
        if (![...form.deviceType.options].some((x) => x.value === last.deviceType)) form.deviceType.add(new Option(last.deviceType, last.deviceType));
        form.deviceType.value = last.deviceType;
      }
      form.brand.value = ld.brand;
      form.model.value = ld.model;
      form.color.value = last.color || '';
      form.model.dispatchEvent(new Event('input', { bubbles: true }));
      form.fault.focus();
    });
  }

  function showHistory(c) {
    showSame(c);
    const h = form.querySelector('.ord-hist');
    if (!c) { h.innerHTML = ''; return; }
    const list = clientOrders(c.id, store.data);
    h.innerHTML = `<div class="sect"><h3>Постоянный клиент: ${list.length} ${plural(list.length, 'ремонт', 'ремонта', 'ремонтов')}</h3>
      ${list.length ? historyTable(list, store.data) : '<p class="muted small">Заказов ещё не было.</p>'}</div>`;
  }
  function onPhone() {
    const c = findClient(store.data.clients, form.phone.value);
    if (c && c.id !== auto.id) {
      if (!form.name.value.trim() || form.name.value === auto.name) form.name.value = c.name || '';
      if (!form.source.value.trim() || form.source.value === auto.source) form.source.value = c.source || '';
      Object.assign(auto, { id: c.id, name: form.name.value, source: form.source.value });
    } else if (!c && auto.id) {
      if (form.name.value === auto.name) form.name.value = '';
      if (form.source.value === auto.source) form.source.value = '';
      Object.assign(auto, { id: '', name: '', source: '' });
    }
    showHistory(c);
  }
  form.phone.addEventListener('input', onPhone);
  form.addEventListener('input', (e) => {
    e.target.classList.remove('bad');
    e.target.parentElement.querySelector('.field-err')?.remove();
  });
  form.querySelector('.ord-hist').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-order]');
    if (tr) { ui.closeModal(); ctx.navigate('orders', { orderId: tr.dataset.order }); }
  });
  if (pre) { auto.id = pre.id; auto.name = pre.name || ''; auto.source = pre.source || ''; showHistory(pre); } else if (preset.phone) onPhone();
  (pre ? form.deviceType : form.phone).focus();
  const state0 = formState(form); // что было при открытии (с подставленным заранее) — Esc спрашивает, только если изменили

  let sending = false; // защита от повторной отправки, пока ждём ответ
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    errBox.hidden = true;
    const f = ui.formData(form);
    const errs = {};
    if (!f.phone) errs.phone = 'Укажите телефон';
    else if (!ui.phoneValid(f.phone)) errs.phone = ui.PHONE_ERR;
    if (!f.name) errs.name = 'Укажите ФИО клиента';
    for (const [k, t] of Object.entries(REQUIRED)) if (!f[k]) errs[k] = t;
    if (!f.point) errs.point = 'Выберите точку';
    if (f.approxPrice < 0) errs.approxPrice = 'Цена не может быть отрицательной';
    const files = [...form.photos.files];
    const perr = photosError(files, MAX_PHOTOS);
    if (perr) errs.photos = perr;
    form.querySelectorAll('.field-err').forEach((x) => x.remove());
    form.querySelectorAll('.bad').forEach((x) => x.classList.remove('bad'));
    const keys = Object.keys(errs);
    if (keys.length) {
      for (const k of keys) {
        form[k].classList.add('bad');
        form[k].insertAdjacentHTML('afterend', `<div class="field-err">${esc(errs[k])}</div>`);
      }
      form[keys[0]].focus();
      return;
    }
    const btn = box.querySelector('[type=submit]');
    sending = true;
    try {
      const order = await ui.busy(btn, async () => {
        let c = findClient(store.data.clients, f.phone);
        if (!c) c = await store.create('clients', { name: f.name, phone: ui.fmtPhone(f.phone), source: f.source });
        else if (c.name !== f.name || (f.source && c.source !== f.source)) {
          c = await store.update('clients', c.id, { name: f.name, ...(f.source ? { source: f.source } : {}) });
        }
        const rec = await store.create('orders', {
          client: c.id, point: f.point, source: f.source, deviceType: f.deviceType, brand: f.brand, model: f.model, color: f.color,
          appearance: f.appearance, fault: f.fault, approxPrice: Math.round(f.approxPrice || 0), due: ui.fromInputDate(f.due),
          acceptedBy: f.acceptedBy, repairedBy: f.repairedBy, notifySms: f.notifySms,
          ...(orig ? { warrantyOf: orig.id, price: 0, approxPrice: 0 } : {}),
          ...(files.length ? { photos: files } : {}),
        });
        // Заказ уже создан: ошибка отметки заявки не должна вести к повторной отправке формы (дубль заказа).
        if (preset.lead) await updateLead(store, preset.lead, { status: 'done', order: rec.id }).catch((e) => ui.showError(e));
        return rec;
      });
      ui.closeModal();
      ui.toast(orig ? `Гарантийный заказ № ${order.num} создан` : `Заказ № ${order.num} создан`);
      ctx.navigate('orders', { orderId: order.id });
      // Сразу бланк приёма клиенту на подпись: печать после отрисовки карточки (window.print блокирует страницу).
      setTimeout(() => printBlank(ui, store.data, store.data.orders.find((x) => x.id === order.id) || order, 'template'), 150);
    } catch (err) {
      errBox.textContent = ui.errorText(err);
      errBox.hidden = false;
      errBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } finally { sending = false; }
  });
}

// Снимок полей формы для «есть ли несохранённый ввод»: значения, галочки, число выбранных файлов.
function formState(form) {
  return JSON.stringify([...form.elements].filter((el) => el.name).map((el) =>
    (el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.type === 'file' ? el.files.length : el.value)));
}

// Подсказки марки и модели в форме (form.brand, form.model): марка выбрана → сразу список её моделей;
// модель без марки («iPhone 13») подставляет марку сама. getType() — тип устройства, afterModel() — после выбора модели.
// Общие для «Нового заказа» и «Быстрого заказа» (order-quick.js).
export function deviceSuggest(form, store, getType, afterModel) {
  suggest(form.brand, () => brandOptions(store.data.orders, getType()), esc, () => {
    form.brand.dispatchEvent(new Event('input', { bubbles: true }));
    form.model.focus();
  });
  suggest(form.model, () => modelOptions(store.data.orders, getType(), form.brand.value.trim()),
    (x) => (form.brand.value.trim() ? esc(x.model) : `${esc(x.model)} <span class="muted small">${esc(x.brand)}</span>`),
    (x) => {
      if (x.brand && !form.brand.value.trim()) form.brand.value = x.brand;
      form.model.dispatchEvent(new Event('input', { bubbles: true }));
      afterModel?.();
    });
}

// Выпадающий список под полем «Марка»/«Модель»: ищет по бренду и по-русски (searchModels: «apple», «айфон 11 про»).
// getItems() — марки (строки) или модели {brand, model}; html(x) — строка списка; onPick(x) — после выбора.
// ↑↓ — выбор, Enter — подставить, Esc — закрыть.
function suggest(input, getItems, html, onPick) {
  const list = document.createElement('div');
  list.className = 'sugg';
  list.hidden = true;
  input.parentElement.classList.add('sugg-wrap');
  input.after(list);
  let items = [];
  let cur = -1;
  const close = () => { list.hidden = true; cur = -1; };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const val = (x) => (typeof x === 'string' ? x : x.model);
    items = searchModels(getItems(), input.value, 15);
    if (items.length === 1 && val(items[0]).toLowerCase() === q) items = [];
    list.innerHTML = items.map((x, i) => `<button type="button" tabindex="-1" class="sugg-i${i === cur ? ' on' : ''}" data-i="${i}">${html(x)}</button>`).join('');
    list.hidden = !items.length || document.activeElement !== input;
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (x) => { input.value = typeof x === 'string' ? x : x.model; close(); onPick(x); };
  input.addEventListener('focus', () => { cur = -1; draw(); });
  input.addEventListener('input', () => { cur = -1; draw(); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  list.addEventListener('mousedown', (e) => e.preventDefault()); // не терять фокус поля при клике по списку
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pick(items[Number(b.dataset.i)]); });
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      draw();
    } else if (e.key === 'Enter' && cur >= 0) { e.preventDefault(); pick(items[cur]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
}

// Выпадающий список вариантов с галочками под полем «Внешний вид»/«Неисправность» (стиль .sugg).
// getItems() — строки-варианты. Клик или ↑↓+Enter — добавить/убрать вариант в тексте через запятую (toggleItem),
// список остаётся открытым; ввод фильтрует по последнему фрагменту; закрывают кнопка «Готово» внизу списка, Esc (только список) и клик мимо.
// После выбора поле получает input; при закрытии списка, если значение изменилось, — change (сохранение как при ручном вводе).
function multiPick(input, getItems) {
  if (!input) return;
  const list = document.createElement('div');
  list.className = 'sugg mpick';
  list.hidden = true;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-multiselectable', 'true');
  input.parentElement.classList.add('sugg-wrap');
  input.after(list);
  const low = (s) => String(s || '').trim().toLowerCase();
  let items = [];
  let cur = -1;
  let start = input.value; // значение на момент последнего change
  const frag = () => low(String(input.value).split(/[,;\n]/).pop());
  const draw = () => {
    const all = getItems() || [];
    const q = frag();
    items = q && !all.some((x) => low(x) === q) ? all.filter((x) => low(x).includes(q)) : all;
    if (cur >= items.length) cur = items.length - 1;
    list.innerHTML = items.map((x, i) => {
      const on = hasItem(input.value, x);
      return `<button type="button" tabindex="-1" role="option" aria-selected="${on}" class="sugg-i mp-i${i === cur ? ' on' : ''}${on ? ' sel' : ''}" data-i="${i}"><span class="mp-box" aria-hidden="true">${on ? '✓' : ''}</span>${esc(x)}</button>`;
    }).join('') + '<button type="button" tabindex="-1" class="btn mp-done" data-done>Готово</button>';
    list.hidden = !items.length || document.activeElement !== input;
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  const commit = () => { if (input.value !== start) { start = input.value; input.dispatchEvent(new Event('change', { bubbles: true })); } };
  const close = () => { const was = !list.hidden; list.hidden = true; cur = -1; if (was) commit(); };
  const toggle = (x) => {
    let v = input.value;
    const q = frag();
    // набранный для поиска кусок («цара») заменяется выбранным вариантом; свой текст остаётся
    if (q && low(x).includes(q) && !hasItem(v, x)) v = v.replace(/[^,;\n]*$/, '');
    input.value = toggleItem(v, x);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    draw();
  };
  input.addEventListener('change', () => { start = input.value; });
  input.addEventListener('focus', () => { cur = -1; draw(); });
  input.addEventListener('click', () => { if (list.hidden) draw(); });
  input.addEventListener('input', (e) => { if (e.isTrusted) { cur = -1; draw(); } });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 150));
  list.addEventListener('mousedown', (e) => e.preventDefault()); // не терять фокус поля при клике по списку
  list.addEventListener('click', (e) => {
    if (e.target.closest('[data-done]')) { close(); return; }
    const b = e.target.closest('[data-i]');
    if (b) toggle(items[Number(b.dataset.i)]);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && list.hidden) { e.preventDefault(); cur = 0; draw(); return; }
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      cur = (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      draw();
    } else if (e.key === 'Enter' && cur >= 0) { e.preventDefault(); toggle(items[cur]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
}

// Печать бланка: field — 'template' (приём) или 'templateIssue' (акт выдачи и гарантийный талон).
function printBlank(ui, data, o, field) {
  const tpl = (data.settings[0] || {})[field] || '';
  if (!tpl.trim()) { ui.toast('Текст бланка пуст — заполните его во вкладке «Настройки»', 'warn'); return; }
  ui.printHtml(blankHtml(tpl, blankVars(o, data)));
}

// ---------- карточка ----------

// Значки ленты истории (inline SVG, цвет — currentColor).
const SVG = (d) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const BUBBLE = '<path d="M4 5h16v11H9l-5 4z"/>';
const WRENCH = '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>';
const EV_ICON = {
  created: SVG('<path d="M12 5v14M5 12h14"/>'),
  status: SVG('<path d="M5 21V4h11l-2 4 2 4H5"/>'),
  edit: SVG('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  payment: '<b aria-hidden="true">₽</b>', 'payment-': '<b aria-hidden="true">₽</b>',
  part: SVG(WRENCH), 'part-': SVG(WRENCH),
  sms: SVG(BUBBLE), remind: SVG('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0"/>'),
  comment: SVG(`${BUBBLE}<path d="M8 9h8M8 12h5"/>`),
  photos: SVG('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
};
const WIDE = '(min-width:1100px)';

// Выбор мастера: «— не назначен —», у старых заказов без учётки — сохранённое имя.
function masterOptions(store, ui, o) {
  const head = !o.repairedBy && o.repairedName ? `<option value="">${ui.esc(o.repairedName)} (без учётки)</option>` : '';
  return `${head}<option value=""${o.repairedBy || head ? '' : ' selected'}>— не назначен —</option>`
    + ui.options(store.data.users.filter((u) => u.active !== false || u.id === o.repairedBy), o.repairedBy, (u) => u.name || u.email);
}

function renderCard(el, ctx, o) {
  const { store, ui, calc } = ctx;
  const { esc } = ui;
  const data = store.data;
  const owner = store.isOwner;
  const c = data.clients.find((x) => x.id === o.client) || null;
  const parts = data.order_parts.filter((p) => p.order === o.id);
  const pays = data.payments.filter((p) => p.order === o.id).sort((a, b) => String(a.at || a.created).localeCompare(String(b.at || b.created)));
  const paid = calc.orderPaid(o, data);
  const debt = calc.orderDebt(o, data);
  const issued = o.status === 'issued';
  const tab = state.tab === 'work' ? 'work' : 'info';

  const inp = (f, label, { type = 'text', cls = '', list = '' } = {}) => {
    const v = type === 'date' ? ui.toInputDate(o[f]) : (NUM_F.has(f) ? (Number(o[f]) || '') : (o[f] ?? ''));
    return `<label class="${cls}">${esc(label)}<input data-f="${f}" type="${type}"${type === 'number' ? ' min="0" step="1" inputmode="numeric"' : ''}${list ? ` list="${list}"` : ''} value="${esc(v)}"></label>`;
  };
  const master = `<label>Мастер<select data-f="repairedBy">${masterOptions(store, ui, o)}</select></label>`;
  const manual = calc.hasManualPay(o) ? Number(o.masterPayManual) : '';
  const pr = calc.profit(o, data);
  const mp = calc.masterPay(o, data);
  const warranty = calc.isWarranty(o);
  const mpNote = warranty ? 'гарантия' : calc.hasManualPay(o) ? 'вручную' : calc.isOwner(o.repairedBy, data) ? 'владелец' : `${calc.toPct(calc.rate(o.point, data))}%`;
  const now = new Date();
  const late = calc.overdueDays(o, now);
  const days = calc.forgotDays(data);
  const forgot = calc.isForgotten(o, now, days);
  const orig = warranty ? data.orders.find((x) => x.id === o.warrantyOf) : null;
  const returns = data.orders.filter((x) => x.warrantyOf === o.id).sort((a, b) => (Number(a.num) || 0) - (Number(b.num) || 0));
  const photos = Array.isArray(o.photos) ? o.photos : [];
  const photoUrl = (f, thumb) => store.pb.files.getURL(o, f, thumb ? { thumb } : {});
  const nOrders = c ? clientOrders(c.id, data).length : 0;
  const kbModel = orderDevice(o);
  const kbArts = kbModel ? articlesForOrder(data.kb_articles || [], o) : [];
  const badges = [
    late ? `<span class="ord-badge bad">Просрочено на ${late} дн.</span>` : '',
    forgot ? `<span class="ord-badge warn">Забыто: «Готов» с ${esc(ui.fmtDate(o.readyAt || o.updated))}</span>` : '',
    warranty ? `<button type="button" class="ord-badge link" data-goto="${esc(o.warrantyOf)}"${orig ? '' : ' disabled'}>Гарантия по № ${esc(orig ? orig.num : '?')}</button>` : '',
    ...returns.map((r) => `<button type="button" class="ord-badge link" data-goto="${esc(r.id)}">Гарантийный возврат № ${esc(r.num)}</button>`),
    kbArts.length ? `<button type="button" class="ord-badge link" data-kb title="База знаний по модели">Статьи по ${esc(kbModel)} (${kbArts.length})</button>` : '',
  ].join('');
  const remindItem = o.status === 'ready' ? '<button type="button" role="menuitem" data-remind disabled title="Проверяем, когда напоминали…">Напомнить клиенту</button>' : '';
  const delItem = owner ? '<button type="button" role="menuitem" class="danger" data-del>Удалить заказ</button>' : '';

  // Три группы с подзаголовками, как в панели «Новый заказ»: клиент, устройство, приём.
  const info = `<div class="oc-grid">
      <h4 class="oc-sub">Клиент</h4>
      ${c ? `<label>ФИО<input data-cf="name" value="${esc(c.name || '')}"></label>
        <label>Телефон<input data-cf="phone" type="tel" value="${esc(ui.fmtPhone(c.phone))}"></label>`
        : '<p class="muted small oc-c2">Клиент не указан</p>'}
      ${inp('source', 'Источник', { list: 'ordSrc2', cls: 'oc-c2' })}
      <h4 class="oc-sub">Устройство</h4>
      ${inp('deviceType', 'Тип *', { list: 'ordDev2' })}${inp('brand', 'Марка')}${inp('model', 'Модель *')}${inp('color', 'Цвет', { list: 'ordColor2' })}
      <label class="full">Внешний вид<input data-f="appearance" autocomplete="off" placeholder="выберите из списка или впишите" value="${esc(o.appearance || '')}"></label>
      <label class="full">Неисправность *<textarea data-f="fault" rows="2" placeholder="выберите из списка или опишите своими словами">${esc(o.fault || '')}</textarea></label>
      <h4 class="oc-sub">Приём</h4>
      <label>Точка<select data-f="point">${ui.options(data.points, o.point)}</select></label>
      ${inp('approxPrice', 'Примерная цена, ₽', { type: 'number' })}${inp('due', 'Срок', { type: 'date' })}
      <label>Принял<select data-f="acceptedBy">${userOptions(store, ui, o.acceptedBy, o.acceptedName)}</select></label>
      ${master}
      <label class="check"><input type="checkbox" data-f="notifySms"${o.notifySms ? ' checked' : ''}> Сообщить по СМС, когда будет готов</label>
    </div>
    <div class="oc-photos"><span class="oc-lbl">Фото ${photos.length} из ${MAX_PHOTOS}</span>
      ${photos.map((f, i) => `<div class="ord-ph">
        <button type="button" class="ord-phbtn" data-ph="${esc(f)}" aria-label="Фото ${i + 1} крупно"><img src="${esc(photoUrl(f, '100x100'))}" alt="Фото ${i + 1}" loading="lazy" width="64" height="64"></button>
        ${owner ? `<button type="button" class="del" data-delph="${esc(f)}" aria-label="Удалить фото ${i + 1}" title="Удалить фото">×</button>` : ''}</div>`).join('')}
      ${photos.length < MAX_PHOTOS ? `<label class="ord-phadd" title="Снять или выбрать фото">+ Фото<input type="file" accept="image/*" capture="environment" multiple data-addph hidden></label>` : ''}
    </div>
    <datalist id="ordSrc2">${SOURCES.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
    <datalist id="ordDev2">${DEVICE_TYPES.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
    <datalist id="ordColor2">${COLORS.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>`;

  const totals = `<dl class="oc-totals">
      <dt>${warranty ? 'Цена' : Number(o.price) ? 'Цена' : 'Примерная цена'}</dt><dd>${ui.money(calc.orderBase(o))}</dd>
      <dt>Запчасти</dt><dd>${ui.money(calc.partsCost(o, data))}</dd>
      ${warranty ? `<dt>Расход на гарантию</dt><dd class="neg">${ui.money(-calc.ownerFromOrder(o, data))}</dd>`
        : `<dt>Прибыль</dt><dd class="${pr < 0 ? 'neg' : ''}">${ui.money(pr)}</dd>`}
      <dt>ЗП мастера <span class="muted">(${esc(mpNote)})</span></dt><dd>${ui.money(mp)}</dd>
      <dt class="pos">Внесено</dt><dd class="pos">${ui.money(paid)}</dd>
      <dt>К доплате</dt><dd class="${debt ? 'neg' : ''}">${ui.money(debt)}</dd></dl>`;

  const work = `${warranty ? '<p class="ord-note">Гарантийный ремонт: цена 0 ₽, мастеру 0 ₽; запчасти и курьер — расход сервиса на гарантию.</p>' : ''}
    <div class="oc-grid oc-work">
      ${master}
      ${warranty ? '' : inp('price', 'Точная цена, ₽', { type: 'number' })}${inp('warranty', 'Гарантия, мес.', { type: 'number' })}${inp('courier', 'Курьер, ₽', { type: 'number' })}
      ${owner ? `<label>ЗП вручную, ₽<input data-f="masterPayManual" type="number" min="0" step="1" value="${esc(manual)}" placeholder="по ставке"></label>` : ''}
    </div>
    <div class="oc-split">
      <div class="oc-parts">
        <div class="tw"><table class="oc-t"><thead><tr><th>Наименование</th><th class="num">Кол-во</th><th class="num">Закуп</th><th></th></tr></thead><tbody>
          ${parts.map((p) => `<tr><td class="wrap">${esc(p.name || '—')}${p.part ? '' : ' <span class="muted small">(вручную)</span>'}</td>
            <td class="num">${esc(p.qty)}</td><td class="num">${ui.money(calc.partLineCost(p))}${Number(p.qty) > 1 ? `<div class="muted small">по ${ui.money(p.cost)}</div>` : ''}</td>
            <td>${owner ? `<button type="button" class="del" data-delpart="${esc(p.id)}" aria-label="Убрать запчасть" title="Убрать (со склада вернётся)">×</button>` : ''}</td></tr>`).join('')
            || '<tr><td colspan="4" class="muted small">Запчастей пока нет</td></tr>'}
        </tbody></table></div>
        <button type="button" class="btn ghost sm ord-mt" data-addpart>+ Запчасть</button>
        <div class="ord-picker" hidden></div>
      </div>
      ${totals}
    </div>
    <h4 class="oc-sub oc-h">Оплаты</h4>
    ${pays.length ? `<div class="tw"><table class="oc-t"><thead><tr><th>Когда</th><th class="num">Сумма</th><th>Как</th><th>Кто принял</th>${owner ? '<th></th>' : ''}</tr></thead><tbody>
      ${pays.map((p) => `<tr><td>${esc(ui.fmtDateTime(p.at || p.created))}</td><td class="num">${ui.money(p.amount)}</td><td>${esc(p.method || '—')}</td>
        <td>${esc(personName(p.by, '', data) || '—')}</td>
        ${owner ? `<td><button type="button" class="del" data-delpay="${esc(p.id)}" aria-label="Удалить оплату">×</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div>` : ''}
    ${/* Предоплату не берут: деньги принимаются в окне «Выдать». Здесь — только доплата по уже выданному заказу с долгом. */ ''}
    ${warranty ? '<p class="muted small">Гарантийный ремонт — оплата не принимается.</p>'
    : !issued ? '<p class="muted small">Оплата принимается при выдаче — кнопка «Выдать».</p>'
    : debt > 0 ? `<form class="row oc-pay" id="payForm" novalidate>
      <input type="number" name="amount" min="1" step="1" inputmode="numeric" placeholder="Сумма, ₽" value="${esc(debt)}" aria-label="Сумма доплаты">
      <select name="method" aria-label="Форма оплаты">${ui.options(PAY_METHODS, o.payMethod || 'Нал')}</select>
      <button type="submit" class="btn sm">Принять доплату</button>
    </form>` : ''}
    <label class="oc-note">Заметка / рекомендации<textarea data-f="note" rows="2">${esc(o.note || '')}</textarea></label>`;

  el.innerHTML = `<div class="oc">
    <div class="oc-top">
      <div class="oc-h1">
        <button type="button" class="oc-back" data-back aria-label="К списку заказов" title="К списку заказов">←</button>
        <h2>Заказ № ${esc(o.num)}</h2>${statusChip(o.status)}
        <span class="ord-dev">${esc(deviceText(o))}</span>
        ${c ? `<button type="button" class="oc-client" data-client="${esc(c.id)}" title="Карточка клиента">${esc(c.name || '—')} · ${esc(ui.fmtPhone(c.phone))}</button>
          <span class="muted small">${nOrders} ${plural(nOrders, 'заказ', 'заказа', 'заказов')}</span>` : ''}
      </div>
      <div class="oc-h2"><span class="muted small">Принят ${esc(ui.fmtDateTime(o.acceptedAt || o.created))} · ${esc(ui.pointName(o.point))}${issued && o.issuedAt ? ` · выдан ${esc(ui.fmtDateTime(o.issuedAt))}` : ''}</span>${badges}</div>
      <div class="ord-status" role="group" aria-label="Статус">${STATUSES.map(([k, t]) =>
        `<button type="button" class="chip btnlike st-${k}${o.status === k ? ' on' : ''}" data-status="${k}">${esc(t)}</button>`).join('')}</div>
    </div>
    <div class="oc-body">
      <div class="oc-tabs" role="tablist" aria-label="Разделы заказа">
        <button type="button" role="tab" data-tab="info" aria-selected="${tab === 'info'}">${SVG('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>')} Информация о заказе</button>
        <button type="button" role="tab" data-tab="work" aria-selected="${tab === 'work'}">Работы и материалы ${SVG(WRENCH)}</button>
      </div>
      <div class="oc-pane" role="tabpanel" data-pane="info"${tab === 'info' ? '' : ' hidden'}>${info}</div>
      <div class="oc-pane" role="tabpanel" data-pane="work"${tab === 'work' ? '' : ' hidden'}>${work}</div>
    </div>
    <div class="oc-hist"><details class="oc-hd">
      <summary>История <span class="oc-hn"></span></summary>
      <div class="oc-hbody">
        <div class="oc-tl"><p class="muted small">Загрузка…</p></div>
        <form class="oc-cmt" novalidate>
          <textarea rows="2" maxlength="2000" placeholder="Комментарий…&#10;Shift + Enter — новая строка" aria-label="Комментарий к заказу"></textarea>
          <button type="submit" class="btn sm" aria-label="Отправить комментарий" title="Отправить (Enter)">${SVG('<path d="M4 12l16-8-6 16-2-7z"/>')}</button>
        </form>
      </div>
    </details></div>
    <div class="oc-bar">
      ${issued ? '<button type="button" class="btn" data-warranty>Гарантия</button>' : '<button type="button" class="btn" data-issue>Выдать</button>'}
      <button type="button" class="btn ghost" data-back>Закрыть</button>
      <span class="oc-gap"></span>
      <div class="oc-mwrap"><button type="button" class="btn ghost" data-menu aria-haspopup="menu" aria-expanded="false">Печать ▾</button>
        <div class="oc-menu" role="menu" hidden>
          <button type="button" role="menuitem" data-print="template">Бланк приёма</button>
          ${issued ? '<button type="button" role="menuitem" data-print="templateIssue">Акт выдачи и гарантия</button>' : ''}</div></div>
      ${remindItem || delItem ? `<div class="oc-mwrap"><button type="button" class="btn ghost oc-more" data-menu aria-haspopup="menu" aria-expanded="false" aria-label="Ещё действия" title="Ещё">⋮</button>
        <div class="oc-menu" role="menu" hidden>${remindItem}${delItem}</div></div>` : ''}
    </div>
  </div>`;

  // --- навигация и действия ---
  el.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => ctx.navigate('orders')));
  el.querySelector('[data-client]')?.addEventListener('click', () => ctx.navigate('clients', { clientId: c.id }));
  el.querySelector('[data-issue]')?.addEventListener('click', () => openIssue(ctx, o.id));
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    el.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    el.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== state.tab; });
  }));
  menus(el);
  el.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => printBlank(ui, data, o, b.dataset.print)));
  el.querySelector('[data-del]')?.addEventListener('click', async (e) => {
    if (!(await ui.confirmDlg(`Удалить заказ № ${o.num} вместе с запчастями, оплатами и историей? Запчасти со склада вернутся на склад.`, { ok: 'Удалить' }))) return;
    try {
      await ui.busy(e.target, store.remove('orders', o.id));
      ui.toast(`Заказ № ${o.num} удалён`);
      ctx.navigate('orders');
    } catch (err) { ui.showError(err); }
  });

  // --- статусы ---
  el.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', async () => {
    const s = b.dataset.status;
    if (s === o.status) return;
    if (s === 'issued') { openIssue(ctx, o.id); return; }
    if (issued && !(await ui.confirmDlg(`Вернуть заказ из выданных в «${STATUS_LABEL[s]}»? Дата выдачи сбросится, заказ уйдёт из финансов.`, { ok: 'Вернуть' }))) return;
    try {
      await ui.busy(b, store.update('orders', o.id, { status: s }));
      ui.toast(`Статус: ${STATUS_LABEL[s]}`);
    } catch (err) { ui.showError(err); }
  }));

  // --- поля заказа правятся на месте ---
  const fieldErr = (input, text) => {
    input.classList.add('bad');
    input.parentElement.querySelector('.field-err')?.remove();
    if (text) input.insertAdjacentHTML('afterend', `<div class="field-err">${esc(text)}</div>`);
  };
  const brandIn = el.querySelector('[data-f=brand]');
  const modelIn = el.querySelector('[data-f=model]');
  suggest(brandIn, () => brandOptions(data.orders, o.deviceType), esc, () => brandIn.dispatchEvent(new Event('change')));
  suggest(modelIn, () => modelOptions(data.orders, o.deviceType, brandIn.value.trim()),
    (x) => (brandIn.value.trim() ? esc(x.model) : `${esc(x.model)} <span class="muted small">${esc(x.brand)}</span>`),
    (x) => {
      if (x.brand && !brandIn.value.trim()) { brandIn.value = x.brand; brandIn.dispatchEvent(new Event('change')); }
      modelIn.dispatchEvent(new Event('change'));
    });
  multiPick(el.querySelector('[data-f=appearance]'), () => APPEARANCE);
  multiPick(el.querySelector('[data-f=fault]'), () => faultChips(o.deviceType));
  el.querySelectorAll('[data-f]').forEach((input) => input.addEventListener('change', async () => {
    const f = input.dataset.f;
    let v = input.type === 'checkbox' ? input.checked : input.value.trim();
    el.querySelectorAll(`[data-f="${f}"]`).forEach((x) => { if (x !== input) x.value = input.value; }); // «Мастер» стоит на обеих вкладках
    input.classList.remove('bad');
    input.parentElement.querySelector('.field-err')?.remove();
    if (REQUIRED[f] && !v) { fieldErr(input, REQUIRED[f]); return; }
    if (NUM_F.has(f)) { v = v === '' ? 0 : Number(v); if (!(v >= 0)) { fieldErr(input, 'Введите число не меньше 0'); return; } v = Math.round(v); }
    if (f === 'masterPayManual') { v = v === '' ? null : Number(v); if (v !== null && !(v >= 0)) { fieldErr(input, 'Введите число не меньше 0'); return; } }
    if (DATE_F.has(f)) v = ui.fromInputDate(v);
    try {
      await store.update('orders', o.id, { [f]: v });
      ui.toast('Сохранено');
    } catch (err) { fieldErr(input, ui.errorText(err)); ui.showError(err); }
  }));
  el.querySelectorAll('[data-cf]').forEach((input) => input.addEventListener('change', async () => {
    const f = input.dataset.cf;
    const v = input.value.trim();
    input.classList.remove('bad');
    input.parentElement.querySelector('.field-err')?.remove();
    if (!v) { fieldErr(input, f === 'name' ? 'Укажите ФИО' : 'Укажите телефон'); return; }
    if (f === 'phone') {
      if (!ui.phoneValid(v)) { fieldErr(input, ui.PHONE_ERR); return; }
      const other = findClient(data.clients, v);
      if (other && other.id !== c.id) { fieldErr(input, `Этот номер уже у клиента «${other.name}»`); return; }
    }
    try {
      await store.update('clients', c.id, { [f]: f === 'phone' ? ui.fmtPhone(v) : v });
      ui.toast('Клиент сохранён');
    } catch (err) { fieldErr(input, ui.errorText(err)); ui.showError(err); }
  }));

  // --- запчасти ---
  const pickerHost = el.querySelector('.ord-picker');
  el.querySelector('[data-addpart]').addEventListener('click', (e) => {
    pickerHost.hidden = !pickerHost.hidden;
    e.target.textContent = pickerHost.hidden ? '+ Запчасть' : 'Скрыть выбор запчасти';
    if (!pickerHost.hidden && !pickerHost.firstChild) {
      partPicker(pickerHost, {
        store, ui, pointId: o.point,
        onAdd: async (item) => {
          await store.create('order_parts', { order: o.id, part: item.part, name: item.name, qty: item.qty, cost: item.cost });
          ui.toast(item.part ? 'Запчасть добавлена и списана со склада' : 'Запчасть добавлена');
        },
      });
      pickerHost.querySelector('input')?.focus();
    }
  });
  el.querySelectorAll('[data-delpart]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await ui.confirmDlg('Убрать запчасть из заказа? Если она со склада — вернётся на склад.', { ok: 'Убрать' }))) return;
    try { await ui.busy(b, store.remove('order_parts', b.dataset.delpart)); } catch (err) { ui.showError(err); }
  }));

  // --- оплаты ---
  const payForm = el.querySelector('#payForm');
  payForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = ui.formData(payForm);
    payForm.amount.classList.remove('bad');
    payForm.querySelector('.field-err')?.remove();
    if (!(f.amount > 0)) { payForm.amount.classList.add('bad'); payForm.insertAdjacentHTML('beforeend', '<div class="field-err">Укажите сумму больше 0</div>'); payForm.amount.focus(); return; }
    try {
      await ui.busy(payForm.querySelector('button'), store.create('payments', { order: o.id, amount: Math.round(f.amount), method: f.method, by: store.me.id }));
      // Отдельного поля «Форма оплаты» в карточке нет: способ последней оплаты идёт в заказ (бланк, Excel).
      if (o.payMethod !== f.method) await store.update('orders', o.id, { payMethod: f.method }).catch((err) => ui.showError(err));
      ui.toast(`Оплата ${ui.money(f.amount)} принята`);
    } catch (err) { ui.showError(err); }
  });
  el.querySelectorAll('[data-delpay]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await ui.confirmDlg('Удалить запись об оплате?', { ok: 'Удалить' }))) return;
    try { await ui.busy(b, store.remove('payments', b.dataset.delpay)); } catch (err) { ui.showError(err); }
  }));

  // --- переходы по гарантии ---
  el.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => ctx.navigate('orders', { orderId: b.dataset.goto })));
  el.querySelector('[data-kb]')?.addEventListener('click', () => ctx.navigate('kb', { model: kbModel }));
  el.querySelector('[data-warranty]')?.addEventListener('click', async () => {
    const wc = warrantyCheck(o);
    if (!wc.ok && !(await ui.confirmDlg(`${wc.text}. Всё равно оформить гарантийный заказ?`, { ok: 'Оформить', danger: false }))) return;
    openCreate(ctx, '', warrantyDraft(o));
  });

  // --- фото ---
  el.querySelectorAll('[data-ph]').forEach((b) => b.addEventListener('click', () => {
    const f = b.dataset.ph;
    ui.openModal(`<div class="head"><h2>Фото · заказ № ${esc(o.num)}</h2><button type="button" class="x-close" data-close aria-label="Закрыть">×</button></div>
      <img class="ord-phbig" src="${esc(photoUrl(f, '600x0'))}" alt="Фото устройства">
      <div class="actions"><a class="btn ghost" href="${esc(photoUrl(f))}" target="_blank" rel="noopener">Открыть оригинал</a><button type="button" class="btn" data-close>Закрыть</button></div>`);
  }));
  el.querySelector('[data-addph]')?.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const err = photosError(files, MAX_PHOTOS - photos.length);
    if (err) { ui.toast(err, 'error'); e.target.value = ''; return; }
    try {
      await ui.busy(e.target.closest('label'), store.update('orders', o.id, { 'photos+': files }));
      ui.toast(files.length > 1 ? `Добавлено фото: ${files.length}` : 'Фото добавлено');
    } catch (er) { ui.showError(er); }
  });
  el.querySelectorAll('[data-delph]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await ui.confirmDlg('Удалить это фото из заказа?', { ok: 'Удалить' }))) return;
    try { await ui.busy(b, store.update('orders', o.id, { 'photos-': [b.dataset.delph] })); ui.toast('Фото удалено'); } catch (err) { ui.showError(err); }
  }));

  // --- история: справа на широком экране (всегда раскрыта), на узком — свёрнутый блок «История (N)» ---
  const hd = el.querySelector('.oc-hd');
  const mq = window.matchMedia(WIDE);
  const syncOpen = () => { if (!el.contains(hd)) { mq.removeEventListener('change', syncOpen); return; } hd.open = mq.matches || state.histOpen; };
  syncOpen();
  mq.addEventListener('change', syncOpen);
  hd.querySelector('summary').addEventListener('click', (e) => { if (mq.matches) e.preventDefault(); });
  hd.addEventListener('toggle', () => { if (!mq.matches) state.histOpen = hd.open; });
  const logHost = el.querySelector('.oc-tl');
  logHost.addEventListener('scroll', () => { state.histScroll = { id: o.id, top: logHost.scrollTop }; });
  logHost.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ev]');
    if (!b) return;
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    b.nextElementSibling.hidden = !open;
    if (open) state.openEv.add(b.dataset.ev); else state.openEv.delete(b.dataset.ev);
  });

  // --- «Напомнить клиенту»: не чаще раза в 24 часа (по журналу) ---
  const remindBtn = el.querySelector('[data-remind]');
  const setRemind = (log) => {
    if (!remindBtn) return;
    const { blockedUntil } = remindState(log);
    remindBtn.disabled = !!blockedUntil;
    remindBtn.title = blockedUntil ? `Уже напоминали. Снова можно после ${ui.fmtDateTime(blockedUntil)}` : 'СМС «устройство готово и ждёт вас» (или отметка о звонке, если СМС не подключено)';
    remindBtn.textContent = blockedUntil ? `Напомнили · снова после ${ui.fmtDateTime(blockedUntil)}` : 'Напомнить клиенту';
  };
  remindBtn?.addEventListener('click', async () => {
    try {
      const r = await ui.busy(remindBtn, store.request(() => store.pb.send('/api/expert/remind', { method: 'POST', body: { orderId: o.id } })));
      ui.toast(r.result || 'Напоминание записано');
    } catch (err) { ui.showError(err); }
    setRemind(await loadLog(logHost, ctx, o, true));
  });

  // --- комментарий: Enter — отправить, Shift+Enter — новая строка ---
  const cmt = el.querySelector('.oc-cmt');
  const ta = cmt.querySelector('textarea');
  if (state.draft.id === o.id) ta.value = state.draft.text;
  ta.addEventListener('input', () => { state.draft = { id: o.id, text: ta.value }; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); cmt.requestSubmit(); }
  });
  let sending = false;
  cmt.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text || sending) return;
    if (text.length > 2000) { ui.toast('Комментарий слишком длинный: не больше 2000 знаков', 'error'); return; }
    sending = true;
    try {
      await ui.busy(cmt.querySelector('button'), store.request(() => store.pb.send('/api/expert/comment', { method: 'POST', body: { orderId: o.id, text } })));
      ta.value = '';
      state.draft = { id: '', text: '' };
      await loadLog(logHost, ctx, o, true);
    } catch (err) { ui.showError(err); } finally { sending = false; }
  });

  loadLog(logHost, ctx, o).then(setRemind);
}

// Меню «Печать ▾» и «⋮»: открываются кнопкой, закрываются Esc, кликом мимо и выбором пункта.
function menus(el) {
  let openBtn = null;
  const close = () => {
    if (!openBtn) return;
    openBtn.setAttribute('aria-expanded', 'false');
    openBtn.nextElementSibling.hidden = true;
    openBtn = null;
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onDown = (e) => { if (!openBtn || !openBtn.parentElement.contains(e.target)) close(); };
  const onKey = (e) => {
    if (!openBtn) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { // ↑↓ — по пунктам меню по кругу
      const items = [...openBtn.nextElementSibling.querySelectorAll('[role=menuitem]:not(:disabled)')];
      if (!items.length) return;
      e.preventDefault(); e.stopPropagation();
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      return;
    }
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    const b = openBtn;
    close();
    b.focus();
  };
  el.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', () => {
    const was = openBtn === b;
    close();
    if (was) return;
    openBtn = b;
    b.setAttribute('aria-expanded', 'true');
    b.nextElementSibling.hidden = false;
    b.nextElementSibling.querySelector('button:not(:disabled)')?.focus();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  }));
  el.querySelectorAll('[role=menuitem]').forEach((b) => b.addEventListener('click', close));
}

// ---------- журнал изменений: лента событий ----------

function logValue(field, v, ctx) {
  const { ui, store } = ctx;
  if (v === '' || v === null || v === undefined) return '—';
  if (field === 'status') return STATUS_LABEL[v] || v;
  if (field === 'acceptedBy' || field === 'repairedBy') return ui.userName(v);
  if (field === 'point') return ui.pointName(v);
  if (field === 'client') return (store.data.clients.find((c) => c.id === v) || {}).name || v;
  if (field === 'notifySms' || field === 'quick') return v === 'true' ? 'да' : 'нет';
  if (field === 'due') return ui.fmtDate(v);
  if (field === 'acceptedAt' || field === 'issuedAt' || field === 'readyAt') return ui.fmtDateTime(v);
  if (field === 'warrantyOf') return '№ ' + ((store.data.orders.find((x) => x.id === v) || {}).num || '?');
  if (['approxPrice', 'price', 'courier', 'masterPayManual'].includes(field) && v !== 'null' && Number.isFinite(Number(v))) return ui.money(v);
  if (v === 'null') return '—';
  return v;
}

// Подробности события (раскрываются кликом); '' — раскрывать нечего.
function eventDetails(e, ctx, who) {
  const { esc } = ctx.ui;
  const row = (k, v) => `<div><span class="muted">${esc(k)}:</span> ${v}</div>`;
  if (e.kind === 'edit' || e.kind === 'status') {
    return e.items.map((x) => `<div><span class="muted">${esc(FIELD_LABEL[x.field] || x.field)}:</span> ${esc(logValue(x.field, x.old, ctx))} → <b>${esc(logValue(x.field, x.new, ctx))}</b></div>`).join('');
  }
  if (e.kind === 'payment' || e.kind === 'payment-') {
    return row('Сумма', `<b class="${e.kind === 'payment' ? 'pos' : 'neg'}">${esc(e.amount || '—')}</b>`) + row('Способ', esc(e.method || '—')) + row('Сотрудник', esc(who || '—'));
  }
  if (e.kind === 'part' || e.kind === 'part-' || e.kind === 'created' || e.kind === 'sms' || e.kind === 'remind') {
    return e.text ? `<div>${esc(e.text)}</div>${who ? row('Кто', esc(who)) : ''}` : '';
  }
  return '';
}

// Загружает журнал и рисует ленту. Пока грузится — показывает прошлую загрузку этого заказа (без мигания).
// toEnd — прокрутить к последним событиям (после комментария).
async function loadLog(host, ctx, o, toEnd = false) {
  const { store, ui } = ctx;
  const draw = (log) => drawTimeline(host, ctx, o, log, toEnd);
  const cached = state.logCache.id === o.id ? state.logCache.log : null;
  if (cached && !toEnd) draw(cached);
  let log;
  try { log = await store.orderLog(o.id); } catch (err) {
    if (host.isConnected && !cached) host.innerHTML = `<p class="muted small">Не удалось загрузить историю: ${ui.esc(ui.errorText(err))}</p>`;
    return cached || [];
  }
  state.logCache = { id: o.id, log };
  if (host.isConnected) draw(log);
  return log;
}

function drawTimeline(host, ctx, o, log, toEnd) {
  const { store, ui } = ctx;
  const { esc } = ui;
  const data = store.data;
  const days = timeline(log, { payments: data.payments.filter((p) => p.order === o.id), parts: data.order_parts.filter((p) => p.order === o.id) }, FIELD_LABEL);
  const n = days.reduce((s, d) => s + d.events.length, 0);
  const cnt = host.closest('.oc-hd')?.querySelector('.oc-hn');
  if (cnt) cnt.textContent = `(${n})`;
  const evHtml = (e) => {
    const synth = String(e.id).includes(':');
    const who = e.user ? ui.userName(e.user) : (synth ? '' : 'система');
    const det = eventDetails(e, ctx, who);
    const open = det && state.openEv.has(e.id);
    const time = ui.fmtDateTime(e.at).slice(-5);
    const head = `<span class="tl-ico k-${esc(e.kind.replace('-', '-del'))}">${EV_ICON[e.kind] || EV_ICON.edit}</span>
      <span class="tl-t">${esc(e.title)}${who && e.kind !== 'comment' ? `<span class="tl-who">${esc(who)}</span>` : ''}</span><span class="tl-time">${esc(time)}</span>`;
    if (e.kind === 'comment') {
      return `<li class="tl-ev tl-cmt"><div class="tl-row">${head}</div><div class="tl-det"><b>${esc(who)}</b><div class="tl-text">${esc(e.text)}</div></div></li>`;
    }
    if (!det) return `<li class="tl-ev"><div class="tl-row">${head}</div></li>`;
    return `<li class="tl-ev"><button type="button" class="tl-row" data-ev="${esc(e.id)}" aria-expanded="${open ? 'true' : 'false'}">${head}</button>
      <div class="tl-det"${open ? '' : ' hidden'}>${det}</div></li>`;
  };
  host.innerHTML = days.length
    ? `<ol class="tl">${days.map((d) => `<li class="tl-day"><span>${esc(d.day)}</span></li>${d.events.map(evHtml).join('')}`).join('')}<li class="tl-now"><span>Сейчас</span></li></ol>`
    : '<p class="muted small">Изменений пока нет.</p>';
  const keep = state.histScroll.id === o.id && !toEnd;
  host.scrollTop = keep ? state.histScroll.top : host.scrollHeight;
}
