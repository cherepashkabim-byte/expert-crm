// Выбор запчасти для заказа: со склада точки заказа (поиск, закупочная цена подставляется) или вручную (название + закуп).
// partPicker(host, {store, ui, pointId, onAdd({part, name, qty, cost}) → Promise|void}) → { refresh() }
// Списать можно только запчасть точки заказа; если там её нет — подсказка, на какой точке есть.
// Пока выбор на экране, скан штрихкода находит запчасть точки заказа и добавляет её (как клик по ней).
import { partsAtPoint, stockHint, samePart } from './order-lib.js';
import { listenScan, findByBarcode } from '../scan.js';

const LIMIT = 30;

export function partPicker(host, { store, ui, pointId = '', onAdd }) {
  const { esc } = ui;
  let mode = 'stock';
  host.innerHTML = `<div class="pp">
    <div class="pp-tabs">
      <button type="button" class="chip btnlike on" data-mode="stock">Со склада${pointId ? ' точки' : ''}</button>
      <button type="button" class="chip btnlike" data-mode="manual">Вручную</button>
    </div>
    <div data-pane="stock">
      <div class="pp-row"><input type="search" class="pp-q" placeholder="Поиск: модель, запчасть, категория, штрихкод" aria-label="Поиск запчасти">
      <label class="pp-qty">Кол-во <input type="number" class="pp-n" min="1" step="1" value="1"></label></div>
      ${pointId ? `<p class="muted small pp-pt">Склад точки: ${esc(ui.pointName(pointId))}</p>` : ''}
      <div class="pp-list"></div>
    </div>
    <div data-pane="manual" hidden>
      <div class="pp-row">
        <input class="pp-name" placeholder="Название запчасти" aria-label="Название запчасти">
        <input type="number" class="pp-cost" min="0" placeholder="Закуп, ₽" aria-label="Закуп">
        <input type="number" class="pp-mqty" min="1" step="1" value="1" aria-label="Количество">
        <button type="button" class="btn sm" data-manual>Добавить</button>
      </div>
      <div class="field-err" hidden></div>
    </div>
  </div>`;
  const q = host.querySelector('.pp-q');
  const listEl = host.querySelector('.pp-list');
  const qtyOf = (inp) => Math.max(1, Math.round(Number(inp.value) || 1));

  const add = async (item, btn) => {
    try {
      await ui.busy(btn, Promise.resolve(onAdd(item)));
      return true;
    } catch (e) { ui.showError(e); return false; }
  };

  function refresh() {
    const s = q.value.trim().toLowerCase();
    const words = s.split(/\s+/).filter(Boolean);
    const all = store.data.parts || [];
    const match = (p) => {
      const hay = `${p.model || ''} ${p.name || ''} ${p.category || ''} ${p.barcode || ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    const here = partsAtPoint(all, pointId);
    const found = here.filter(match)
      .sort((a, b) => ((Number(b.stock) > 0) - (Number(a.stock) > 0)) || String(a.model).localeCompare(String(b.model), 'ru'));
    // Есть только на других точках (на этой такой позиции нет совсем) — показываем подсказкой, без выбора.
    const other = pointId && words.length
      ? all.filter((p) => p.point !== pointId && Number(p.stock) > 0 && match(p) && !here.some((h) => samePart(h, p)))
      : [];
    const otherHtml = other.length ? `<p class="muted small pp-other">Нет на этой точке, но есть на других (переместите на складе):</p>
      ${other.slice(0, 10).map((p) => `<div class="pp-item off" aria-disabled="true"><span>${p.model ? `<b>${esc(p.model)}</b> — ` : ''}${esc(p.name || '—')}</span>
        <span class="muted small">${esc(ui.pointName(p.point))}: ${Number(p.stock)} шт.</span></div>`).join('')}` : '';
    if (!here.length && !other.length) { listEl.innerHTML = `<p class="muted small">На складе ${pointId ? 'этой точки ' : ''}пока нет запчастей — добавьте вручную.</p>`; return; }
    if (!found.length) { listEl.innerHTML = `<p class="muted small">Ничего не найдено на этой точке — уточните поиск или добавьте вручную.</p>${otherHtml}`; return; }
    listEl.innerHTML = found.slice(0, LIMIT).map((p) => {
      const st = Number(p.stock) || 0;
      const hint = st > 0 ? '' : stockHint(p, store.data);
      return `<button type="button" class="pp-item${st > 0 ? '' : ' off'}" data-part="${esc(p.id)}">
        <span>${p.model ? `<b>${esc(p.model)}</b> — ` : ''}${esc(p.name || '—')}</span>
        <span class="muted small">${st > 0 ? `остаток ${st}` : 'нет в наличии'} · ${ui.money(p.cost)}</span>
        ${hint ? `<span class="pp-hint small">${esc(hint)}</span>` : ''}</button>`;
    }).join('') + (found.length > LIMIT ? `<p class="muted small">Показаны ${LIMIT} из ${found.length}. Уточните поиск.</p>` : '') + otherHtml;
  }

  host.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    host.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
    host.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== mode; });
    (mode === 'stock' ? q : host.querySelector('.pp-name')).focus();
  }));
  q.addEventListener('input', refresh);
  // Enter внутри выбора не должен отправлять внешнюю форму (окно выдачи).
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    if (mode === 'manual') host.querySelector('[data-manual]').click();
  });
  const pick = async (p, b) => {
    const qty = qtyOf(host.querySelector('.pp-n'));
    const st = Number(p.stock) || 0;
    if (st < qty) {
      const hint = stockHint(p, store.data);
      if (!(await ui.confirmDlg(`На складе этой точки ${st} шт.${hint ? ` (${hint})` : ''}. Всё равно добавить?`, { ok: 'Добавить', danger: false }))) return;
    }
    const name = [p.model, p.name].filter(Boolean).join(' — ');
    if (await add({ part: p.id, name, qty, cost: Number(p.cost) || 0 }, b)) host.querySelector('.pp-n').value = 1;
  };
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-part]');
    if (!b) return;
    const p = store.data.parts.find((x) => x.id === b.dataset.part);
    if (p) pick(p, b);
  });
  // Скан: только пока выбор на экране и не перекрыт другим окном.
  const offScan = listenScan(document, (code) => {
    if (!host.isConnected) { offScan(); return; }
    const modal = document.getElementById('modal');
    if (modal?.firstElementChild && !modal.contains(host)) return;
    if (!host.getClientRects().length) return; // выбор свёрнут или скрыт
    const found = findByBarcode('part', store.data.parts || [], code, pointId);
    const p = found.here || (!pointId ? found.others[0] : null) || null;
    if (!p) { ui.toast(`Запчасть с кодом ${code} не найдена ${pointId ? 'на этой точке' : 'на складе'}`, 'warn'); return; }
    const b = listEl.querySelector(`[data-part="${CSS.escape(p.id)}"]`) || null;
    pick(p, b);
  });
  host.querySelector('[data-manual]').addEventListener('click', async (e) => {
    const name = host.querySelector('.pp-name');
    const cost = host.querySelector('.pp-cost');
    const err = host.querySelector('[data-pane="manual"] .field-err');
    err.hidden = true;
    name.classList.remove('bad');
    if (!name.value.trim()) { err.textContent = 'Укажите название запчасти'; err.hidden = false; name.classList.add('bad'); name.focus(); return; }
    const ok = await add({ part: '', name: name.value.trim(), qty: qtyOf(host.querySelector('.pp-mqty')), cost: Math.max(0, Number(cost.value) || 0) }, e.currentTarget);
    if (ok) { name.value = ''; cost.value = ''; host.querySelector('.pp-mqty').value = 1; name.focus(); }
  });
  refresh();
  return { refresh };
}
