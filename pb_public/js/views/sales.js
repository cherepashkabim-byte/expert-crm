// Продажи и товары (своей вкладки в меню нет): список продаж показывают «Заказы» (режим «Продажи»),
// каталог товаров — «Склад» (переключатель «Товары»). Отсюда же окна «Продажа» и «Новый товар».
// Остаток товара меняет сервер: продажа списывает, удаление продажи возвращает, сверх остатка — 400.
// Товар принадлежит точке: каталог следует за точкой («Все точки» — сводно), продают товар своей точки.
import { transferDialog, movesDialog, elsewhere, stockButtons, stockDialog } from './stock.js';
import { listenScan, findByBarcode } from '../scan.js';
import { periodBar, bindPeriod, periodTitle } from './finance.js';

const METHODS = ['Нал', 'Перевод', 'Терминал'];
const LIMIT = 500;
// point следует за точкой в боковой панели (store.point): выбор «Все точки» действует до следующего переключения.
// kind/date/until — общий переключатель периода (finance.periodBar): день, неделя, месяц, «Период» с … по …, всё время.
const state = { kind: 'month', date: '', until: '', point: '', followed: null, q: '' };

const num = (v) => Number(v) || 0;
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru');

function periodLabel(ui, calc) {
  if (state.kind === 'all') return 'за всё время';
  const { from, to } = calc.periodRange(state.kind, state.date, state.until);
  return periodTitle(state.kind, from, to, ui);
}

// Точка фильтра следует за боковой панелью; «Все точки» держится до следующего переключения.
function syncPoint(store) {
  if (state.followed !== (store.point || '')) { state.followed = store.point || ''; state.point = state.followed; }
  if (state.point && !store.data.points.some((p) => p.id === state.point)) state.point = '';
}

// Перерисовка после смены фильтра: хозяин (вкладка «Заказы»/«Склад») может перехватить событие
// 'sales:rerender' (preventDefault) и перерисовать себя целиком; иначе блок перерисовывается сам.
function rerenderFn(el, fn, ctx) {
  return () => { if (el.dispatchEvent(new Event('sales:rerender', { cancelable: true }))) fn(el, ctx); };
}

// ---------- список продаж ----------

// Список продаж: период, точка, итоги, удаление (владелец), «+ Продажа».
export function renderSales(el, ctx) {
  const { store, ui, calc } = ctx;
  syncPoint(store);
  if (!state.date) state.date = ui.today();
  const { esc, money } = ui;
  const owner = store.isOwner;
  const all = store.data.sales;
  const range = state.kind === 'all' ? { from: null, to: null } : calc.periodRange(state.kind, state.date, state.until);
  const list = all
    .filter((s) => (!state.point || s.point === state.point) && calc.inPeriod(s.at || s.created, range.from, range.to))
    .sort((a, b) => String(b.at || b.created).localeCompare(String(a.at || a.created)));
  const prod = (id) => store.data.products.find((p) => p.id === id);

  const { sum, profit, sellerPay: pay, qty } = calc.salesTotals(list, store.data);
  const rate = calc.salesRate(store.data);

  const rows = list.slice(0, LIMIT).map((s) => {
    const p = prod(s.product);
    const pr = calc.saleProfit(s);
    return `<tr>
      <td>${esc(ui.fmtDateTime(s.at || s.created))}</td>
      <td>${p ? esc(p.name) : '<span class="muted">товар удалён</span>'}</td>
      <td class="num">${num(s.qty)}</td>
      <td class="num">${money(s.price)}</td>
      <td class="num">${money(calc.saleSum(s))}</td>
      <td class="num ${pr < 0 ? 'neg' : ''}">${money(pr)}</td>
      <td>${esc(s.method || '—')}</td>
      <td>${esc(ui.pointName(s.point))}</td>
      <td>${esc(ui.userName(s.seller))}</td>
      ${owner ? `<td><button class="del" data-del="${esc(s.id)}" title="Удалить продажу" aria-label="Удалить продажу">×</button></td>` : ''}</tr>`;
  }).join('');

  let empty;
  if (!store.data.products.length) empty = '<p class="empty">Товаров пока нет — <button class="btn sm" data-newprod2>Добавить товар</button></p>';
  else if (!all.length) empty = '<p class="empty">Продаж пока нет — <button class="btn sm" data-sell2>Оформить продажу</button></p>';
  else empty = '<p class="empty">За выбранный период продаж нет — <button class="btn sm" data-sell2>Оформить продажу</button></p>';

  el.innerHTML = `
    <div class="toolbar">
      ${periodBar(state, ui, { all: true })}
      ${state.kind === 'range' ? '' : `<span class="muted sales-period">${esc(periodLabel(ui, calc))}</span>`}
      <select id="sPoint" aria-label="Точка"><option value="">Все точки</option>${ui.options(store.data.points, state.point)}</select>
      <button class="btn sales-new" data-sell>+ Продажа</button>
    </div>
    ${list.length ? `
    <div class="cards">
      <div class="card"><div class="l muted">Продано на</div><div class="v">${money(sum)}</div></div>
      <div class="card"><div class="l muted">Продаж / штук</div><div class="v">${list.length} / ${qty}</div></div>
      <div class="card"><div class="l muted">Прибыль с продаж</div><div class="v ${profit < 0 ? 'neg' : ''}">${money(profit)}</div></div>
      ${rate > 0 ? `<div class="card"><div class="l muted">ЗП продавцам (${calc.toPct(rate)}%)</div><div class="v">${money(pay)}</div></div>` : ''}
    </div>
    <div class="tw"><table>
      <thead><tr><th>Когда</th><th>Товар</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Сумма</th><th class="num">Прибыль</th>
        <th>Оплата</th><th>Точка</th><th>Продавец</th>${owner ? '<th></th>' : ''}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${list.length > LIMIT ? `<p class="muted small">Показаны последние ${LIMIT} из ${list.length}. Итоги — по всем.</p>` : ''}` : empty}`;

  const again = rerenderFn(el, renderSales, ctx);
  el.querySelector('[data-sell]').addEventListener('click', () => saleDialog(ctx));
  el.querySelector('#sPoint').addEventListener('change', (e) => { state.point = e.target.value; again(); });
  bindPeriod(el, state, ctx, again);
  el.querySelector('[data-newprod2]')?.addEventListener('click', () => productDialog(ctx));
  el.querySelector('[data-sell2]')?.addEventListener('click', () => saleDialog(ctx));
  if (owner) el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const s = store.data.sales.find((x) => x.id === b.dataset.del);
    if (!s) return;
    const p = prod(s.product);
    if (!(await ui.confirmDlg(`Удалить продажу «${p ? p.name : 'товар'}» × ${num(s.qty)}? Товар вернётся на склад.`, { ok: 'Удалить' }))) return;
    try { await ui.busy(b, store.remove('sales', s.id)); ui.toast('Продажа удалена, товар возвращён'); } catch (err) { ui.showError(err); }
  }));
}

// ---------- каталог товаров ----------

const PCOLS = [['name', 'Название', 'text'], ['category', 'Категория', 'text'], ['barcode', 'Штрихкод', 'text'],
  ['cost', 'Закупка', 'number'], ['price', 'Цена продажи', 'number']];

// Каталог товаров: точка, поиск (и по штрихкоду), правка на месте, приход/списание, перемещение, продажа, удаление.
// ctx.point (необязательно) — точку задаёт хозяин (вкладка «Склад» со своим переключателем точки): тогда своего выбора точки нет.
export function renderProducts(el, ctx) {
  const { store, ui, calc } = ctx;
  syncPoint(store);
  const hosted = ctx.point !== undefined;
  const vp = hosted ? ctx.point || '' : state.point;
  const { esc, money } = ui;
  const owner = store.isOwner;
  const all = !vp;
  const here = store.point; // продавать можно только товар своей точки
  const pointSort = (id) => store.data.points.findIndex((p) => p.id === id);
  const prods = store.data.products.filter((p) => all || p.point === vp).sort((a, b) =>
    String(a.category || '').localeCompare(String(b.category || ''), 'ru') || byName(a, b) || pointSort(a.point) - pointSort(b.point));
  const worth = calc.stockValue(prods).total;
  const canMove = store.data.points.length > 1;
  const byPoint = all ? store.data.points.map((pt) => {
    const v = calc.stockValue(store.data.products.filter((p) => p.point === pt.id));
    return `<span><b>${esc(pt.name)}</b>: ${money(v.total)} · ${v.units} шт.</span>`;
  }).join('') : '';

  const rows = prods.map((p) => {
    const out = num(p.stock) <= 0;
    const pname = ui.pointName(p.point);
    const hay = [p.name, p.category, p.barcode, all ? pname : ''].join(' ').toLowerCase();
    const hint = out ? elsewhere('product', store.data.products, p, ui) : '';
    let sellOff = '';
    if (out) sellOff = ' disabled title="Нет в наличии"';
    else if (here && p.point !== here) sellOff = ' disabled title="Товар на другой точке — продать можно только товар своей точки"';
    return `<tr data-id="${esc(p.id)}" data-hay="${esc(hay)}" class="${out ? 'zero' : ''}">
      ${all ? `<td class="pt">${esc(pname)}</td>` : ''}
      ${PCOLS.map(([f, t, type]) => `<td${type === 'number' ? ' class="num"' : ''}><input type="${type}" data-f="${f}" value="${esc(p[f] ?? '')}" aria-label="${esc(t)}"${type === 'number' ? ' min="0" step="1" inputmode="numeric"' : ' class="wide"'}></td>`).join('')}
      <td class="num stock-n">${out ? `<span class="chip bad">нет в наличии</span>${hint ? `<div class="small muted where">${esc(hint)}</div>` : ''}` : num(p.stock)}</td>
      <td class="acts">${stockButtons(ctx, p, vp)}
        ${canMove ? `<button class="btn sm ghost" data-move="${esc(p.id)}"${out ? ' disabled title="Нечего перемещать: остаток 0"' : ''}>Переместить</button>` : ''}
        <button class="btn sm" data-sellp="${esc(p.id)}"${sellOff}>Продать</button></td>
      ${owner ? `<td><button class="del" data-del="${esc(p.id)}" title="Удалить товар" aria-label="Удалить товар">×</button></td>` : ''}</tr>`;
  }).join('');

  const toolbar = `<div class="toolbar">
      ${hosted ? '' : `<select id="pPoint" aria-label="Точка"><option value="">Все точки</option>${ui.options(store.data.points, vp)}</select>`}
      ${prods.length ? `<input type="search" id="pQ" class="sales-q" placeholder="Поиск: название, категория, штрихкод" value="${esc(state.q)}" aria-label="Поиск товара">
      <span class="muted small">Товара на складе на ${money(worth)}</span>` : ''}
      <button class="btn sm ghost" data-moves>История перемещений</button>
      <button class="btn sm" data-newprod>+ Товар</button>
    </div>`;
  el.innerHTML = toolbar + (prods.length ? `
    ${byPoint ? `<p class="prod-points small">${byPoint}</p>` : ''}
    <div class="tw"><table class="prod-t">
      <thead><tr>${all ? '<th>Точка</th>' : ''}${PCOLS.map(([, t, type]) => `<th${type === 'number' ? ' class="num"' : ''}>${t}</th>`).join('')}<th class="num">Остаток</th><th></th>${owner ? '<th></th>' : ''}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="empty" id="pNone" hidden>Ничего не найдено</p>`
    : `<p class="empty">${all ? 'Товаров пока нет' : 'На этой точке товаров пока нет'} — <button class="btn sm" data-newprod2>Добавить товар</button></p>`);

  const again = rerenderFn(el, renderProducts, ctx);
  el.querySelector('#pPoint')?.addEventListener('change', (e) => { state.point = e.target.value; again(); });
  el.querySelector('[data-newprod]').addEventListener('click', () => productDialog(ctx, { point: vp }));
  el.querySelector('[data-moves]').addEventListener('click', () => movesDialog(ctx, 'product', vp));
  el.querySelector('[data-newprod2]')?.addEventListener('click', () => productDialog(ctx, { point: vp }));
  if (!prods.length) return;

  const q = el.querySelector('#pQ');
  const apply = () => {
    const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    el.querySelectorAll('tbody tr').forEach((tr) => { tr.hidden = !words.every((w) => tr.dataset.hay.includes(w)); if (!tr.hidden) shown++; });
    el.querySelector('#pNone').hidden = shown > 0;
  };
  q.addEventListener('input', () => { state.q = q.value; apply(); });
  apply();

  el.querySelectorAll('tbody input[data-f]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = inp.defaultValue; inp.blur(); } });
    inp.addEventListener('change', async () => {
      const id = inp.closest('tr').dataset.id;
      const f = inp.dataset.f;
      const v = inp.type === 'number' ? (inp.value === '' ? 0 : Number(inp.value)) : inp.value.trim();
      if (f === 'name' && !v) { ui.toast('Название товара не может быть пустым', 'warn'); inp.value = inp.defaultValue; return; }
      if (inp.type === 'number' && (!Number.isFinite(v) || v < 0)) { ui.toast('Нужно число не меньше 0', 'warn'); inp.value = inp.defaultValue; return; }
      inp.classList.remove('bad');
      try {
        await store.update('products', id, { [f]: v });
        inp.defaultValue = String(v);
        inp.classList.add('saved');
        setTimeout(() => inp.classList.remove('saved'), 900);
      } catch (err) { inp.classList.add('bad'); ui.showError(err); }
    });
  });

  el.querySelectorAll('[data-in]').forEach((b) => b.addEventListener('click', () => stockDialog(ctx, 'product', b.dataset.in, 'in')));
  el.querySelectorAll('[data-out]').forEach((b) => b.addEventListener('click', () => stockDialog(ctx, 'product', b.dataset.out, 'out')));
  el.querySelectorAll('[data-sellp]').forEach((b) => b.addEventListener('click', () => saleDialog(ctx, b.dataset.sellp)));
  el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => transferDialog(ctx, 'product', b.dataset.move, again)));
  if (owner) el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const p = store.data.products.find((x) => x.id === b.dataset.del);
    if (!p) return;
    const used = store.data.sales.filter((s) => s.product === p.id).length;
    const warn = used ? ` По нему ${used} продаж(и) — в них товар станет «удалён».` : '';
    if (!(await ui.confirmDlg(`Удалить товар «${p.name}» (${ui.pointName(p.point)}) из каталога?${warn}`, { ok: 'Удалить' }))) return;
    try { await ui.busy(b, store.remove('products', p.id)); ui.toast('Товар удалён'); } catch (err) { ui.showError(err); }
  }));
}

// ---------- диалоги ----------

function formError(box, ui, ex) {
  const err = box.querySelector('.err');
  err.textContent = typeof ex === 'string' ? ex : ui.errorText(ex);
  err.hidden = false;
}

// Окно «Новый товар». preset — {name, category, cost, price, barcode, point} (например, из скана штрихкода).
export function productDialog({ store, ui }, preset = {}) {
  const { esc } = ui;
  const point = preset.point || state.point || store.point;
  const v = (f) => esc(preset[f] ?? '');
  const cats = [...new Set(store.data.products.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  ui.openModal(`
    <h3>Новый товар</h3>
    <form class="fields" novalidate>
      <label class="full">Название *<input name="name" placeholder="Кабель USB-C 1 м" value="${v('name')}" required autofocus></label>
      <label>Категория<input name="category" list="prodCats" placeholder="Кабели" value="${v('category')}"></label>
      <label>Штрихкод<input name="barcode" maxlength="64" placeholder="Отсканируйте или введите" value="${v('barcode')}"></label>
      <label>Закупка за шт., ₽<input name="cost" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="${v('cost')}"></label>
      <label>Цена продажи, ₽<input name="price" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="${v('price')}"></label>
      <label>Остаток, шт.<input name="stock" type="number" min="0" step="1" inputmode="numeric" value="${preset.barcode ? 1 : 0}"></label>
      <label>Точка *<select name="point">${point ? '' : '<option value="">— выберите —</option>'}${ui.options(store.data.points, point)}</select></label>
      <datalist id="prodCats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <p class="err full" hidden></p>
      <div class="actions full"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn" type="submit">Добавить</button></div>
    </form>`, (box) => {
    const form = box.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = ui.formData(form);
      box.querySelector('.err').hidden = true;
      form.name.classList.toggle('bad', !d.name);
      if (!d.name) return formError(box, ui, 'Укажите название товара');
      if (!d.point) return formError(box, ui, 'Выберите точку, на которую пришёл товар');
      if (d.cost < 0 || d.price < 0 || d.stock < 0) return formError(box, ui, 'Числа не могут быть отрицательными');
      try {
        await ui.busy(form.querySelector('[type=submit]'), store.create('products', d));
        ui.closeModal();
        ui.toast(`Товар добавлен на ${ui.pointName(d.point)}`);
      } catch (ex) { formError(box, ui, ex); }
    });
  });
}

// Окно «Продажа» (панель справа). Пока оно открыто, скан штрихкода выбирает товар этой точки; повторный скан того же — +1 шт.
export function saleDialog({ store, ui, calc }, productId = '') {
  const { esc, money } = ui;
  if (!store.data.products.length) { productDialog({ store, ui }); return; }
  const me = store.me || {};
  // Продаётся только товар точки продажи (текущей точки боковой панели).
  if (!store.point) {
    ui.openModal(`<h3>Продажа</h3><p>Сначала выберите точку в боковой панели</p>
      <div class="actions"><button type="button" class="btn" data-close>Понятно</button></div>`);
    return;
  }
  const prods = () => store.data.products.filter((p) => p.point === store.point).sort(byName);
  if (!prods().length) { ui.toast('На этой точке товаров нет — добавьте товар или переместите с другой точки', 'warn'); return; }
  const label = (p) => `${p.name}${p.category ? ` (${p.category})` : ''} — ${money(p.price)}, ${num(p.stock) > 0 ? `ост. ${num(p.stock)}` : 'нет в наличии'}`;
  const first = (prods().some((p) => p.id === productId) ? productId : '') || (prods().find((p) => num(p.stock) > 0) || prods()[0]).id;
  const p0 = store.data.products.find((p) => p.id === first);

  ui.openModal(`
    <div class="dr-head"><h2>Продажа</h2><button type="button" class="x-close" data-close aria-label="Закрыть">×</button></div>
    <div class="dr-body"><form id="saleForm" novalidate>
      <h3 class="dr-sect">Товар</h3>
      <div class="fields">
        <label class="full">Найти товар<input type="search" data-q placeholder="Начните вводить название или категорию"${productId ? '' : ' autofocus'}></label>
        <label class="full">Товар *<select name="product" required>${ui.options(prods(), first, label)}</select></label>
        <label>Количество *<input name="qty" type="number" min="1" step="1" inputmode="numeric" value="1"${productId ? ' autofocus' : ''}></label>
        <label>Цена за шт., ₽ *<input name="price" type="number" min="0" step="1" inputmode="numeric" value="${esc(num(p0?.price))}"></label>
      </div>
      <h3 class="dr-sect">Оплата</h3>
      <div class="fields">
        <label>Оплата<select name="method">${ui.options(METHODS, 'Нал')}</select></label>
        <label>Точка<input value="${esc(store.point ? ui.pointName(store.point) : 'не выбрана')}" disabled></label>
        <label>Продавец<input value="${esc(me.name || me.email || '—')}" disabled></label>
        <div class="full sale-sum"><span>Итого: <b data-total></b></span> <span class="muted" data-left></span> <span data-pay></span></div>
        <p class="err full" hidden></p>
      </div>
    </form></div>
    <div class="dr-foot"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn" type="submit" form="saleForm">Продать</button></div>`, (box) => {
    const form = box.querySelector('form');
    const sel = form.product;
    const q = box.querySelector('[data-q]');
    const cur = () => store.data.products.find((p) => p.id === sel.value);

    const refresh = () => {
      const p = cur();
      const d = ui.formData(form);
      box.querySelector('[data-total]').textContent = money(calc.saleSum(d));
      const left = box.querySelector('[data-left]');
      const lack = !!p && num(d.qty) > num(p.stock);
      const hint = lack ? elsewhere('product', store.data.products, p, ui) : '';
      left.textContent = p ? `в наличии: ${num(p.stock)} шт.${hint ? ` · ${hint}` : ''}` : '';
      left.classList.toggle('neg', lack);
      const rate = calc.salesRate(store.data);
      box.querySelector('[data-pay]').textContent = rate > 0 && p
        ? `· ЗП продавца: ${money(calc.sellerPay({ seller: me.id, qty: d.qty, price: d.price, cost: p.cost }, store.data))}` : '';
    };
    const fill = (keep) => {
      const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      const list = prods().filter((p) => words.every((w) => `${p.name} ${p.category}`.toLowerCase().includes(w)));
      const was = sel.value;
      sel.innerHTML = list.length ? ui.options(list, keep ? was : '', label) : '<option value="">— ничего не найдено —</option>';
      if (!keep || !list.some((p) => p.id === was)) {
        const p = list.find((x) => num(x.stock) > 0) || list[0];
        sel.value = p ? p.id : '';
      }
      if (sel.value !== was) form.price.value = num(cur()?.price);
      refresh();
    };
    q.addEventListener('input', () => fill(true));
    sel.addEventListener('change', () => { form.price.value = num(cur()?.price); refresh(); });
    form.qty.addEventListener('input', refresh);
    form.price.addEventListener('input', refresh);
    refresh();

    const off = store.on((ch) => { if (ch.collection === 'products' || ch.collection === 'settings' || ch.type === 'load') fill(true); });
    document.addEventListener('ui:modalclose', off, { once: true });

    let scanned = '';
    const offScan = listenScan(document, (code) => {
      if (!box.isConnected) { offScan(); return; }
      if (!store.point) { ui.toast('Выберите точку — продажа только со своей точки', 'warn'); return; }
      const p = findByBarcode('product', store.data.products, code, store.point).here;
      if (!p) { ui.toast(`Товар с кодом ${code} не найден на этой точке`, 'warn'); return; }
      if (scanned === p.id && sel.value === p.id) {
        form.qty.value = Math.max(1, Math.round(num(form.qty.value))) + 1;
      } else {
        if (![...sel.options].some((o) => o.value === p.id)) { q.value = ''; fill(true); }
        sel.value = p.id;
        form.price.value = num(p.price);
        form.qty.value = 1;
      }
      scanned = p.id;
      refresh();
    });
    document.addEventListener('ui:modalclose', offScan, { once: true });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = ui.formData(form);
      box.querySelector('.err').hidden = true;
      if (!d.product) return formError(box, ui, 'Выберите товар');
      if (!(d.qty > 0) || !Number.isInteger(d.qty)) return formError(box, ui, 'Количество — целое число больше 0');
      if (d.price < 0) return formError(box, ui, 'Цена не может быть отрицательной');
      if (!store.point) return formError(box, ui, 'Сначала выберите точку в боковой панели');
      const data = { product: d.product, qty: d.qty, price: d.price, method: d.method, point: store.point, seller: me.id };
      try {
        await ui.busy(box.querySelector('[type=submit]'), store.create('sales', data));
        ui.closeModal();
        ui.toast(`Продано: ${cur()?.name || 'товар'} × ${d.qty}`);
      } catch (ex) { formError(box, ui, ex); }
    });
  }, { drawer: true });
}
