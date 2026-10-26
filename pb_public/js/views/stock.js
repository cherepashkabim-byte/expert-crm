// Вкладка «Склад»: запчасти текущей точки (следует за переключателем; «Все точки» — сводно).
// Правка прямо в таблице, поиск, итог по складу, перемещение на другую точку и история перемещений.
// Удаление — только владелец. Остатки при установке запчасти в заказ и при перемещении меняет сервер.
// Отсюда же sales.js берёт общие для товаров диалоги: transferDialog, movesDialog, elsewhere.
// Сверху переключатель «Запчасти | Товары»: товары рисует sales.renderProducts. navigate('stock', {tab: 'products'|'parts'}).
// Сканер штрихкодов: пока вкладка на экране, скан открывает приход позиции текущей точки (повтор — +1 шт.).
import { renderProducts, productDialog } from './sales.js';
import { listenScan, findByBarcode, normCode } from '../scan.js';

// point следует за точкой в боковой панели (store.point): выбор «Все точки» действует до следующего переключения.
const state = { q: '', point: '', followed: null, tab: 'parts' };
let scanOff = null;

// Колонки таблицы: поле, заголовок, тип редактора.
const COLS = [
  ['model', 'Модель устройства', 'text'],
  ['name', 'Запчасть', 'text'],
  ['category', 'Категория', 'text'],
  ['cost', 'Закупка', 'number'],
  ['stock', 'Кол-во', 'number'],
  ['supplier', 'Поставщик', 'text'],
  ['comment', 'Комментарий', 'text'],
  ['barcode', 'Штрихкод', 'text'],
];

const num = (v) => Number(v) || 0;
const norm = (s) => String(s || '').trim().toLowerCase();
const hay = (p, pname) => [p.model, p.name, p.category, p.supplier, p.comment, p.barcode, pname].join(' ').toLowerCase();

// «Та же» позиция на другой точке — как на сервере: модель+название (запчасти) / название (товары), без регистра.
export const sameItem = (kind, a, b) => norm(a.name) === norm(b.name) && (kind !== 'part' || norm(a.model) === norm(b.model));

// Где ещё есть эта позиция: «есть на пр-т Советский 24: 3 шт.» ('' — нигде).
export function elsewhere(kind, list, item, ui) {
  const found = (list || []).filter((x) => x.id !== item.id && x.point !== item.point && num(x.stock) > 0 && sameItem(kind, x, item));
  return found.length ? 'есть на ' + found.map((x) => `${ui.pointName(x.point)}: ${num(x.stock)} шт.`).join(', ') : '';
}

export default {
  id: 'stock',
  title: 'Склад',
  render(el, ctx) {
    const { store, ui, calc } = ctx;
    const { esc, money } = ui;
    const owner = store.isOwner;
    if (state.followed !== (store.point || '')) { state.followed = store.point || ''; state.point = state.followed; }
    if (state.point && !store.data.points.some((p) => p.id === state.point)) state.point = '';
    if (ctx.params?.tab === 'products' || ctx.params?.tab === 'parts') state.tab = ctx.params.tab;
    const all = !state.point;
    const rerender = () => this.render(el, ctx);
    const setScanRoot = startScan(el, ctx);
    const nProds = store.data.products.filter((p) => all || p.point === state.point).length;
    const switcher = `<div class="toolbar stock-tabs">
        <button class="chip btnlike${state.tab === 'parts' ? ' on accent' : ''}" data-stab="parts">Запчасти</button>
        <button class="chip btnlike${state.tab === 'products' ? ' on accent' : ''}" data-stab="products">Товары (${nProds})</button>
      </div>`;
    const pointSel = `<select id="stockPoint" aria-label="Точка"><option value="">Все точки</option>${ui.options(store.data.points, state.point)}</select>`;
    const bindTop = () => {
      el.querySelectorAll('[data-stab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.stab; rerender(); }));
      el.querySelector('#stockPoint').addEventListener('change', (e) => { state.point = e.target.value; rerender(); });
    };
    const whereTxt = all ? 'все точки' : ui.pointName(state.point);
    if (state.tab === 'products') {
      el.innerHTML = `<div class="stock-root">
        <div class="head"><h2>Склад <span class="muted small">· ${esc(whereTxt)}</span></h2></div>
        ${switcher}<div class="toolbar">${pointSel}</div>
        <div id="stockProducts"></div></div>`;
      setScanRoot(el.querySelector('.stock-root'));
      bindTop();
      const body = el.querySelector('#stockProducts');
      body.addEventListener('sales:rerender', (e) => { e.preventDefault(); rerender(); });
      renderProducts(body, { ...ctx, point: state.point });
      return;
    }

    const pointSort = (id) => store.data.points.findIndex((p) => p.id === id);
    const parts = store.data.parts.filter((p) => all || p.point === state.point).sort((a, b) =>
      String(a.model || '').localeCompare(String(b.model || ''), 'ru') || String(a.name || '').localeCompare(String(b.name || ''), 'ru')
      || pointSort(a.point) - pointSort(b.point));

    const { total, units, zero } = calc.stockValue(parts);
    const canMove = store.data.points.length > 1;

    const rows = parts.map((p) => {
      const out = num(p.stock) <= 0;
      const pname = ui.pointName(p.point);
      const cells = COLS.map(([f, t, type]) => {
        const v = p[f] ?? '';
        // Остаток не правится напрямую: только «+ приход», «Списать» и «Переместить».
        if (f === 'stock') return `<td class="num stock-n">${num(v)}</td>`;
        const cls = type === 'text' ? ' class="wide"' : '';
        const extra = type === 'number' ? ' min="0" step="1" inputmode="numeric"' : '';
        return `<td${type === 'number' ? ' class="num"' : ''}><input${cls} type="${type}" data-f="${f}" value="${esc(v)}" aria-label="${esc(t)}"${extra}></td>`;
      });
      cells.splice(5, 0, `<td class="num sum">${money(calc.stockValue([p]).total)}</td>`);
      if (all) cells.unshift(`<td class="pt">${esc(pname)}</td>`);
      const hint = out ? elsewhere('part', store.data.parts, p, ui) : '';
      return `<tr data-id="${esc(p.id)}" data-hay="${esc(hay(p, all ? pname : ''))}" class="${out ? 'zero' : ''}">
        ${cells.join('')}
        <td class="st">${out ? `<span class="chip bad">нет в наличии</span>${hint ? `<div class="small muted where">${esc(hint)}</div>` : ''}` : ''}</td>
        <td class="acts">${stockButtons(ctx, p, state.point)}
          ${canMove ? `<button class="btn sm ghost" data-move="${esc(p.id)}"${out ? ' disabled title="Нечего перемещать: остаток 0"' : ''}>Переместить</button>` : ''}</td>
        ${owner ? `<td><button class="del" data-del="${esc(p.id)}" title="Удалить" aria-label="Удалить">×</button></td>` : ''}</tr>`;
    }).join('');

    // Сводно по точкам — только в режиме «Все точки».
    const byPoint = all ? store.data.points.map((pt) => {
      const v = calc.stockValue(store.data.parts.filter((p) => p.point === pt.id));
      return `<span><b>${esc(pt.name)}</b>: ${money(v.total)} · ${v.units} шт.</span>`;
    }).join('') : '';

    el.innerHTML = `<div class="stock-root">
      <div class="head"><h2>Склад <span class="muted small">· ${esc(whereTxt)}</span></h2>
        <div class="toolbar stock-head"><button class="btn ghost" data-moves>История перемещений</button><button class="btn" data-add>+ Добавить запчасть</button></div></div>
      ${switcher}
      <div class="toolbar">
        ${pointSel}
        ${parts.length ? `<input type="search" id="stockQ" class="stock-q" placeholder="Поиск: модель, запчасть, категория, поставщик, штрихкод" value="${esc(state.q)}" aria-label="Поиск">
        <span class="muted small" id="stockCount"></span>` : ''}
      </div>
      ${parts.length ? `
      <div class="cards">
        <div class="card"><div class="l muted">На складе на</div><div class="v">${money(total)}</div></div>
        <div class="card"><div class="l muted">Позиций / штук</div><div class="v">${parts.length} / ${units}</div></div>
        <div class="card"><div class="l muted">Нет в наличии</div><div class="v${zero ? ' neg' : ''}">${zero}</div></div>
      </div>
      ${byPoint ? `<p class="stock-points small">${byPoint}</p>` : ''}
      <div class="tw"><table class="stock-t">
        <thead><tr>${all ? '<th>Точка</th>' : ''}${COLS.slice(0, 5).map(([, t]) => `<th>${t}</th>`).join('')}<th class="num">Сумма</th>
          ${COLS.slice(5).map(([, t]) => `<th>${t}</th>`).join('')}<th></th><th></th>${owner ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows}</tbody></table></div>
      <p class="empty" id="stockNone" hidden>Ничего не найдено — <button class="btn sm ghost" id="stockClear">Сбросить поиск</button></p>`
      : `<p class="empty">${all ? 'Запчастей пока нет' : 'На этой точке запчастей пока нет'} — <button class="btn sm" data-add>Добавить запчасть</button></p>`}</div>`;

    el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addDialog(store, ui, state.point || store.point)));
    setScanRoot(el.querySelector('.stock-root'));
    bindTop();
    el.querySelector('[data-moves]').addEventListener('click', () => movesDialog(ctx, 'part', state.point));
    if (!parts.length) return;

    // Поиск без перерисовки — чтобы не терять фокус в поле.
    const q = el.querySelector('#stockQ');
    const apply = () => {
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      el.querySelectorAll('tbody tr').forEach((tr) => {
        const ok = words.every((w) => tr.dataset.hay.includes(w));
        tr.hidden = !ok;
        if (ok) shown++;
      });
      el.querySelector('#stockCount').textContent = words.length ? `Найдено: ${shown} из ${parts.length}` : '';
      el.querySelector('#stockNone').hidden = shown > 0;
    };
    q.addEventListener('input', () => { state.q = q.value; apply(); });
    el.querySelector('#stockClear').addEventListener('click', () => { state.q = ''; q.value = ''; apply(); q.focus(); });
    apply();

    // Правка на месте: сохраняем по change (Enter или уход с поля).
    el.querySelectorAll('tbody input[data-f]').forEach((inp) => {
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = inp.defaultValue; inp.blur(); } });
      inp.addEventListener('change', async () => {
        const id = inp.closest('tr').dataset.id;
        const f = inp.dataset.f;
        let v = inp.type === 'number' ? (inp.value === '' ? 0 : Number(inp.value)) : inp.value.trim();
        if (f === 'name' && !v) { ui.toast('Название запчасти не может быть пустым', 'warn'); inp.value = inp.defaultValue; return; }
        if (inp.type === 'number' && (!Number.isFinite(v) || v < 0)) { ui.toast('Нужно число не меньше 0', 'warn'); inp.value = inp.defaultValue; return; }
        inp.classList.remove('bad');
        try {
          await store.update('parts', id, { [f]: v });
          inp.defaultValue = String(v);
          inp.classList.add('saved');
          setTimeout(() => inp.classList.remove('saved'), 900);
        } catch (err) { inp.classList.add('bad'); ui.showError(err); }
      });
    });

    el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => transferDialog(ctx, 'part', b.dataset.move, rerender)));
    el.querySelectorAll('[data-in]').forEach((b) => b.addEventListener('click', () => stockDialog(ctx, 'part', b.dataset.in, 'in')));
    el.querySelectorAll('[data-out]').forEach((b) => b.addEventListener('click', () => stockDialog(ctx, 'part', b.dataset.out, 'out')));

    if (owner) el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const p = store.data.parts.find((x) => x.id === b.dataset.del);
      if (!p) return;
      if (!(await ui.confirmDlg(`Удалить запчасть «${[p.model, p.name].filter(Boolean).join(' — ')}» со склада точки ${ui.pointName(p.point)}?`, { ok: 'Удалить' }))) return;
      try { await ui.busy(b, store.remove('parts', p.id)); ui.toast('Запчасть удалена'); } catch (err) { ui.showError(err); }
    }));
  },
};

// Окно «Новая запчасть». preset — {model, name, category, cost, supplier, comment, barcode} (например, из скана).
export function addDialog(store, ui, point, preset = {}) {
  const { esc } = ui;
  const v = (f) => esc(preset[f] ?? '');
  const cats = [...new Set(store.data.parts.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  const sups = [...new Set(store.data.parts.map((p) => p.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  ui.openModal(`
    <h3>Новая запчасть</h3>
    <form class="fields" id="partForm" novalidate>
      <label>Модель устройства<input name="model" placeholder="iPhone 11" autofocus value="${v('model')}"></label>
      <label>Запчасть *<input name="name" placeholder="Дисплей" required value="${v('name')}"></label>
      <label>Категория<input name="category" list="partCats" placeholder="Дисплеи" value="${v('category')}"></label>
      <label>Закупка, ₽<input name="cost" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="${v('cost')}"></label>
      <label>Количество<input name="stock" type="number" min="0" step="1" inputmode="numeric" value="1"></label>
      <label>Поставщик<input name="supplier" list="partSups" value="${v('supplier')}"></label>
      <label>Точка *<select name="point">${point ? '' : '<option value="">— выберите —</option>'}${ui.options(store.data.points, point)}</select></label>
      <label>Комментарий<input name="comment" value="${v('comment')}"></label>
      <label>Штрихкод<input name="barcode" maxlength="64" placeholder="Отсканируйте или введите" value="${v('barcode')}"></label>
      <datalist id="partCats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <datalist id="partSups">${sups.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <p class="err full" hidden></p>
      <div class="actions full"><button type="button" class="btn ghost" data-close>Отмена</button>
        <button class="btn" type="submit">Добавить</button></div>
    </form>`, (box) => {
    const form = box.querySelector('form');
    const err = box.querySelector('.err');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = ui.formData(form);
      err.hidden = true;
      form.name.classList.toggle('bad', !d.name);
      if (!d.name) { err.textContent = 'Укажите, что за запчасть'; err.hidden = false; form.name.focus(); return; }
      if (!d.point) { err.textContent = 'Выберите точку, на которую пришла запчасть'; err.hidden = false; return; }
      if (d.cost < 0 || d.stock < 0) { err.textContent = 'Закупка и количество не могут быть отрицательными'; err.hidden = false; return; }
      try {
        await ui.busy(form.querySelector('[type=submit]'), store.create('parts', d));
        ui.closeModal();
        ui.toast(`Запчасть добавлена на ${ui.pointName(d.point)}`);
      } catch (ex) { err.textContent = ui.errorText(ex); err.hidden = false; }
    });
  });
}

// ---------- перемещение (запчасти и товары) ----------

const COL = { part: 'parts', product: 'products' };
const itemName = (kind, x) => (kind === 'part' ? [x.model, x.name].filter(Boolean).join(' — ') : x.name) || '—';

// Положить запись с сервера в store.data, не дожидаясь realtime (realtime потом перезапишет тем же).
function put(store, col, rec) {
  if (!rec || !rec.id) return;
  const arr = store.data[col];
  const i = arr.findIndex((x) => x.id === rec.id);
  if (i >= 0) arr[i] = rec; else arr.push(rec);
}

export function transferDialog({ store, ui }, kind, id, onDone) {
  const col = COL[kind];
  const src = store.data[col].find((x) => x.id === id);
  if (!src) return;
  const { esc } = ui;
  const targets = store.data.points.filter((p) => p.id !== src.point);
  if (!targets.length) { ui.toast('Другой точки нет — перемещать некуда', 'warn'); return; }
  const there = (pointId) => store.data[col].find((x) => x.point === pointId && sameItem(kind, x, src));

  ui.openModal(`
    <h3>Переместить: ${esc(itemName(kind, src))}</h3>
    <form class="fields" novalidate>
      <p class="muted full">Откуда: <b>${esc(ui.pointName(src.point))}</b>, сейчас там <b class="mv-now">${num(src.stock)}</b> шт.</p>
      <label>Куда *<select name="toPoint">${targets.length > 1 ? '<option value="">— выберите точку —</option>' : ''}${ui.options(targets, '')}</select></label>
      <label>Сколько, шт. *<input name="qty" type="number" min="1" max="${num(src.stock)}" step="1" inputmode="numeric" value="${num(src.stock) >= 1 ? 1 : ''}"></label>
      <p class="muted small full mv-there"></p>
      <p class="err full" hidden></p>
      <div class="actions full"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn" type="submit">Переместить</button></div>
    </form>`, (box) => {
    const form = box.querySelector('form');
    const err = box.querySelector('.err');
    const info = () => {
      const t = form.toPoint.value;
      const x = t && there(t);
      box.querySelector('.mv-there').textContent = !t ? '' : x
        ? `На точке ${ui.pointName(t)} уже есть: ${num(x.stock)} шт. — остаток пополнится.`
        : `На точке ${ui.pointName(t)} такой позиции нет — она появится там.`;
    };
    form.toPoint.addEventListener('change', info);
    info();
    const off = store.on((ch) => {
      if (ch.collection !== col || ch.record?.id !== id) return;
      const cur = store.data[col].find((x) => x.id === id);
      if (cur) { box.querySelector('.mv-now').textContent = num(cur.stock); form.qty.max = num(cur.stock); }
    });
    document.addEventListener('ui:modalclose', off, { once: true });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = ui.formData(form);
      err.hidden = true;
      const show = (t) => { err.textContent = t; err.hidden = false; };
      if (!d.toPoint) return show('Выберите точку-получателя');
      const have = num(store.data[col].find((x) => x.id === id)?.stock);
      if (!(d.qty > 0) || !Number.isInteger(d.qty)) return show('Укажите количество — целое число больше нуля');
      if (d.qty > have) return show(`Нельзя переместить больше, чем есть: ${have} шт.`);
      try {
        const r = await ui.busy(form.querySelector('[type=submit]'),
          store.request(() => store.pb.send('/api/expert/transfer', { method: 'POST', body: { kind, id, toPoint: d.toPoint, qty: d.qty } })));
        put(store, col, r.from);
        put(store, col, r.to);
        if (Array.isArray(store.data.stock_moves)) put(store, 'stock_moves', r.move);
        ui.closeModal();
        ui.toast(`Перемещено ${d.qty} шт. на ${ui.pointName(d.toPoint)}`);
        onDone?.();
      } catch (ex) { show(ui.errorText(ex)); }
    });
  });
}

// ---------- приход и списание (запчасти и товары) ----------

// Менять остаток можно только у позиции своей точки: точки в боковой панели, а если она не выбрана — точки фильтра
// (viewPoint; '' — «Все точки», тогда приход/списание недоступны).
export function stockButtons({ store, ui }, item, viewPoint) {
  const { esc } = ui;
  const own = item.point === (store.point || viewPoint);
  const off = own ? '' :' disabled title="Позиция другой точки — приход и списание только на своей точке"';
  const none = num(item.stock) <= 0 ? ' disabled title="Нечего списывать: остаток 0"' : '';
  return `<button class="btn sm ghost" data-in="${esc(item.id)}"${off}>+ приход</button>
    <button class="btn sm ghost" data-out="${esc(item.id)}"${off || none}>Списать</button>`;
}

// mode 'in' — приход (`stock+` N, можно поправить закупку), 'out' — списание брака/ошибки (`stock+` −N, с подтверждением).
// opts.qty — количество, вписанное сразу (приход по скану). Возвращает box окна.
export function stockDialog({ store, ui }, kind, id, mode, opts = {}) {
  const col = COL[kind];
  const p = store.data[col].find((x) => x.id === id);
  if (!p) return;
  const { esc } = ui;
  const isIn = mode === 'in';
  return ui.openModal(`
    <h3>${isIn ? 'Приход' : 'Списание'}: ${esc(itemName(kind, p))} <span class="muted small">· ${esc(ui.pointName(p.point))}</span></h3>
    <form class="fields" novalidate>
      <p class="muted full">Сейчас на точке: <b class="in-now">${num(p.stock)}</b> шт.</p>
      <label>${isIn ? 'Пришло' : 'Списать'}, шт. *<input name="qty" type="number" min="1" step="1" inputmode="numeric"${isIn ? '' : ` max="${num(p.stock)}"`}${opts.qty ? ` value="${num(opts.qty)}"` : ''} autofocus></label>
      ${isIn ? `<label>Закупка за шт., ₽<input name="cost" type="number" min="0" step="1" inputmode="numeric" value="${esc(num(p.cost))}"></label>`
    : '<p class="muted small full">Для брака или ошибки учёта. Чтобы отдать на другую точку — «Переместить».</p>'}
      <p class="err full" hidden></p>
      <div class="actions full"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn" type="submit">${isIn ? 'Оприходовать' : 'Списать'}</button></div>
    </form>`, (box) => {
    const form = box.querySelector('form');
    const err = box.querySelector('.err');
    const show = (t) => { err.textContent = t; err.hidden = false; };
    const cur = () => store.data[col].find((x) => x.id === id);
    const off = store.on((ch) => {
      if (ch.collection !== col || ch.record?.id !== id) return;
      if (cur()) box.querySelector('.in-now').textContent = num(cur().stock);
    });
    document.addEventListener('ui:modalclose', off, { once: true });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = ui.formData(form);
      err.hidden = true;
      if (!(d.qty > 0) || !Number.isInteger(d.qty)) return show('Укажите количество — целое число больше нуля');
      let patch;
      if (isIn) {
        if (d.cost < 0) return show('Закупка не может быть отрицательной');
        patch = { 'stock+': d.qty };
        if (d.cost !== num(p.cost)) patch.cost = d.cost;
      } else {
        const have = num(cur()?.stock);
        if (d.qty > have) return show(`Нельзя списать больше, чем есть: ${have} шт.`);
        if (!(await ui.confirmDlg(`Списать ${d.qty} шт. «${itemName(kind, p)}» с точки ${ui.pointName(p.point)}? Остаток станет ${have - d.qty} шт.`, { ok: 'Списать' }))) return;
        patch = { 'stock+': -d.qty };
      }
      try {
        await ui.busy(form.querySelector('[type=submit]'), store.update(col, id, patch));
        ui.closeModal();
        ui.toast(isIn ? `Приход +${d.qty} шт. записан` : `Списано ${d.qty} шт.`);
      } catch (ex) { show(ui.errorText(ex)); }
    });
  });
}

// История перемещений: грузится с сервера при открытии (stock_moves только для чтения).
export function movesDialog({ store, ui }, kind, pointId) {
  const { esc } = ui;
  const title = kind === 'part' ? 'запчастей' : 'товаров';
  ui.openModal(`
    <h3>История перемещений ${title}${pointId ? ` · ${esc(ui.pointName(pointId))}` : ''}</h3>
    <div class="moves-body"><p class="muted">Загрузка…</p></div>
    <div class="actions"><button type="button" class="btn ghost" data-close>Закрыть</button></div>`, async (box) => {
    const body = box.querySelector('.moves-body');
    const filter = store.pb.filter(pointId ? 'kind = {:k} && (fromPoint = {:p} || toPoint = {:p})' : 'kind = {:k}', { k: kind, p: pointId });
    let list;
    try {
      list = (await store.request(() => store.pb.collection('stock_moves').getList(1, 200, { filter, sort: '-at,-created' }))).items;
    } catch (ex) { body.innerHTML = `<p class="err">${esc(ui.errorText(ex))}</p>`; return; }
    if (!list.length) { body.innerHTML = '<p class="empty">Перемещений пока не было</p>'; return; }
    body.innerHTML = `<div class="tw"><table class="moves-t">
      <thead><tr><th>Когда</th><th>Что</th><th>Откуда</th><th>Куда</th><th class="num">Шт.</th><th>Кто</th></tr></thead>
      <tbody>${list.map((m) => `<tr>
        <td>${esc(ui.fmtDateTime(m.at || m.created))}</td><td>${esc(m.name || '—')}</td>
        <td>${esc(ui.pointName(m.fromPoint))}</td><td>${esc(ui.pointName(m.toPoint))}</td>
        <td class="num">${num(m.qty)}</td><td>${esc(ui.userName(m.by))}</td></tr>`).join('')}</tbody></table></div>
      ${list.length >= 200 ? '<p class="muted small">Показаны последние 200.</p>' : ''}`;
  });
}

// ---------- сканер штрихкодов на «Складе» ----------

const KIND_COL = [['part', 'parts'], ['product', 'products']];
let inDlg = null; // открытое окно прихода по скану: {box, kind, id}

// Слушатель живёт, пока на экране разметка этой отрисовки (.stock-root); при новой отрисовке прежний снимается.
// Уход со вкладки (другая вкладка перерисовала контейнер) замечает MutationObserver на контейнере —
// слушатель на document снимается сразу, а не при следующем скане.
function startScan(el, ctx) {
  scanOff?.();
  let root = null;
  let mo = null;
  const off = () => {
    offKeys();
    mo?.disconnect();
    mo = null;
    if (scanOff === off) scanOff = null;
  };
  const offKeys = listenScan(document, (code) => {
    if (!root || !root.isConnected) { off(); return; }
    onStockScan(ctx, code);
  });
  scanOff = off;
  if (typeof MutationObserver !== 'undefined') {
    mo = new MutationObserver(() => { if (root && !root.isConnected) off(); });
    mo.observe(el, { childList: true });
  }
  return (node) => { root = node; };
}

function onStockScan(ctx, code) {
  const { store, ui } = ctx;
  if (inDlg && inDlg.box.isConnected) {
    const cur = store.data[COL[inDlg.kind]].find((x) => x.id === inDlg.id);
    if (cur && normCode(cur.barcode) === normCode(code)) {
      const inp = inDlg.box.querySelector('[name=qty]');
      inp.value = Math.max(0, Math.round(num(inp.value))) + 1;
    } else ui.toast('Сначала завершите приход', 'warn');
    return;
  }
  inDlg = null;
  if (ui.isModalOpen()) return; // открыто другое окно — скан не для склада
  if (!state.point) { ui.toast('Выберите точку — приход только на своей точке', 'warn'); return; }
  if (store.point && state.point !== store.point) { ui.toast(`Приход только на своей точке — переключите склад на ${ui.pointName(store.point)}`, 'warn'); return; }
  const order = state.tab === 'products' ? [...KIND_COL].reverse() : KIND_COL;
  for (const [kind, col] of order) {
    const { here } = findByBarcode(kind, store.data[col], code, state.point);
    if (here) {
      const box = stockDialog(ctx, kind, here.id, 'in', { qty: 1 });
      if (box) inDlg = { box, kind, id: here.id };
      return;
    }
  }
  notFoundDialog(ctx, code);
}

// «Код … не найден»: создать товар/запчасть с этим кодом, привязать код к позиции точки,
// или создать здесь то, что с этим кодом есть на другой точке.
function notFoundDialog(ctx, code) {
  const { store, ui } = ctx;
  const { esc } = ui;
  const point = state.point;
  const seen = new Set();
  const others = KIND_COL.flatMap(([kind, col]) => findByBarcode(kind, store.data[col], code, point).others.map((x) => ({ kind, x })))
    .filter(({ kind, x }) => { const k = `${kind}|${norm(x.model)}|${norm(x.name)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  ui.openModal(`
    <h3>Код ${esc(code)} не найден</h3>
    <p class="muted">На точке ${esc(ui.pointName(point))} нет позиции с этим штрихкодом.</p>
    ${others.length ? `<div class="scan-else">${others.map(({ kind, x }, i) => `<div class="scan-else-row">
      <span>Есть на ${esc(ui.pointName(x.point))}: <b>${esc(itemName(kind, x))}</b> <span class="muted small">· ${kind === 'part' ? 'запчасть' : 'товар'}</span></span>
      <button type="button" class="btn sm" data-here="${i}">Создать здесь</button></div>`).join('')}</div>` : ''}
    <div class="actions scan-acts">
      <button type="button" class="btn ghost" data-close>Отмена</button>
      <button type="button" class="btn ghost" data-bind>Привязать к позиции</button>
      <button type="button" class="btn ghost" data-newpart>Новая запчасть</button>
      <button type="button" class="btn" data-newprod>Новый товар</button>
    </div>`, (box) => {
    box.querySelector('[data-newprod]').addEventListener('click', () => productDialog(ctx, { barcode: code, point }));
    box.querySelector('[data-newpart]').addEventListener('click', () => addDialog(store, ui, point, { barcode: code }));
    box.querySelector('[data-bind]').addEventListener('click', () => bindDialog(ctx, code, point));
    box.querySelectorAll('[data-here]').forEach((b) => b.addEventListener('click', () => {
      const { kind, x } = others[Number(b.dataset.here)];
      if (kind === 'product') productDialog(ctx, { name: x.name, category: x.category, cost: x.cost, price: x.price, barcode: code, point });
      else addDialog(store, ui, point, { model: x.model, name: x.name, category: x.category, cost: x.cost, supplier: x.supplier, barcode: code });
    }));
  });
}

// «Привязать к позиции»: поиск по запчастям и товарам точки, выбор → штрихкод сохраняется в позиции.
function bindDialog({ store, ui }, code, point) {
  const { esc } = ui;
  const items = KIND_COL.flatMap(([kind, col]) => store.data[col].filter((x) => x.point === point).map((x) => ({ kind, x })))
    .sort((a, b) => itemName(a.kind, a.x).localeCompare(itemName(b.kind, b.x), 'ru'));
  ui.openModal(`
    <h3>Привязать код ${esc(code)}</h3>
    <input type="search" class="bind-q" placeholder="Поиск: модель, название, категория" aria-label="Поиск позиции" autofocus>
    <div class="bind-list"></div>
    <div class="actions"><button type="button" class="btn ghost" data-close>Отмена</button></div>`, (box) => {
    const q = box.querySelector('.bind-q');
    const listEl = box.querySelector('.bind-list');
    const draw = () => {
      const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      const found = items.filter(({ x }) => words.every((w) => [x.model, x.name, x.category].join(' ').toLowerCase().includes(w)));
      listEl.innerHTML = found.length ? found.slice(0, 50).map(({ kind, x }) => `<button type="button" class="bind-item" data-col="${COL[kind]}" data-id="${esc(x.id)}">
          <span>${esc(itemName(kind, x))}</span>
          <span class="muted small">${kind === 'part' ? 'запчасть' : 'товар'} · ост. ${num(x.stock)}${x.barcode ? ` · код ${esc(x.barcode)}` : ''}</span></button>`).join('')
        : `<p class="muted small">${items.length ? 'Ничего не найдено' : 'На этой точке пока нет позиций'}</p>`;
    };
    q.addEventListener('input', draw);
    draw();
    listEl.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      const x = store.data[b.dataset.col].find((r) => r.id === b.dataset.id);
      if (x?.barcode && normCode(x.barcode) !== normCode(code)
        && !(await ui.confirmDlg(`У позиции уже есть код ${x.barcode}. Заменить на ${code}?`, { ok: 'Заменить', danger: false }))) return;
      try {
        await ui.busy(b, store.update(b.dataset.col, b.dataset.id, { barcode: code }));
        ui.closeModal();
        ui.toast('Код привязан — следующий скан откроет приход');
      } catch (ex) { ui.showError(ex); }
    });
  });
}
