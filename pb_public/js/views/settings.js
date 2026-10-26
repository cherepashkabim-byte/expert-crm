// Вкладка «Настройки»: реквизиты, точки и ставки, процент продавцу, срок «забытых» устройств, шаблоны бланков (приём, выдача), перенос из старой версии.
// Меняет только владелец; мастер видит значения без возможности правки.
import { analyze, run, sdkApi } from '../import.js';
import { toPct, fromPct, salesRate } from '../calc.js';
import { quickServices, addService } from './order-quick.js';

// Стандартный шаблон бланка — тот же, что кладёт миграция в settings.template.
const DEFAULT_TEMPLATE = `# ДОГОВОР № {{номер}}
# на ремонт устройства и акт приёма-передачи

{{сервис}} сервис, {{дата}}

{{организация}} (ИНН {{инн}}), далее «Исполнитель», и {{клиент}}, тел. {{телефон}}, далее «Заказчик», заключили договор о нижеследующем.

1. Предмет договора
1.1. Заказчик передаёт, а Исполнитель принимает в ремонт устройство: {{тип}} {{модель}}, цвет {{цвет}}.
1.2. Вид работ: диагностика и ремонт по заявленной неисправности.
1.3. Заявленная неисправность: {{неисправность}}. Комплектация, внешний вид: {{внешний_вид}}.

2. Стоимость и оплата
2.1. Предварительная стоимость работ: {{примерная_цена}}. Окончательная стоимость: {{цена}}. Внесено при приёме: {{предоплата}}. К оплате при выдаче: {{остаток}}.
2.2. Оплата принимается наличными, переводом или картой при выдаче устройства.

3. Сроки
3.1. Планируемый срок ремонта: до {{срок}}. Срок может быть продлён при ожидании запчастей, о чём Исполнитель уведомляет Заказчика.

4. Гарантия
4.1. Гарантия на выполненные работы и установленные запчасти: {{гарантия}} мес. с даты выдачи.
4.2. Гарантия не распространяется на механические повреждения, следы попадания влаги и вскрытия третьими лицами после выдачи.

5. Прочие условия
5.1. При вскрытии устройства могут быть выявлены скрытые неисправности; их устранение и стоимость согласуются с Заказчиком дополнительно.
5.2. Если Заказчик отказывается от ремонта, он оплачивает стоимость диагностики и фактически выполненных работ.
5.3. Исполнитель не отвечает за сохранность данных на устройстве. Резервное копирование — обязанность Заказчика.
5.4. Устройство, не забранное в течение 30 дней после уведомления о готовности, может быть удержано Исполнителем до оплаты хранения.

Реквизиты сторон
Исполнитель: {{организация}}, {{адрес}}, тел. {{телефон_точки}}. Принял: {{принял}}. Мастер: {{мастер}}.
Заказчик: {{клиент}}, тел. {{телефон}}.

Подпись Исполнителя: ____________________          Подпись Заказчика: ____________________

Устройство получено после ремонта, работы выполнены в полном объёме, претензий не имею.
Дата выдачи: {{дата_выдачи}}          Подпись Заказчика: ____________________`;

// Стандартный акт выдачи и гарантийный талон — тот же, что кладёт миграция 1760000000_issue_blank.js в settings.templateIssue.
const DEFAULT_ISSUE_TEMPLATE = `# АКТ ВЫДАЧИ И ГАРАНТИЙНЫЙ ТАЛОН
# к договору № {{номер}} от {{дата}}

{{сервис}} сервис, {{организация}} (ИНН {{инн}}), {{адрес}}, тел. {{телефон_точки}}

Заказчик: {{клиент}}, тел. {{телефон}}
Устройство: {{тип}} {{модель}}, цвет {{цвет}}
Заявленная неисправность: {{неисправность}}

Выполненные работы и установленные запчасти: {{работы}}
Мастер: {{мастер}}

Стоимость ремонта: {{цена}}. Оплачено: {{оплачено}} ({{способ_оплаты}}). Остаток к оплате: {{остаток}}.

Дата выдачи: {{дата_выдачи}}
Гарантия: {{гарантия}} мес., действует до {{гарантия_до}} включительно.

Условия гарантии
1. Гарантия распространяется на выполненные работы и установленные запчасти, указанные в этом акте.
2. Гарантия не распространяется на механические повреждения, следы удара, падения или попадания влаги, вскрытие или ремонт устройства третьими лицами, повреждения из-за неисправных зарядных устройств и неправильной эксплуатации.
3. Для гарантийного обслуживания принесите устройство и этот акт в любой сервис {{сервис}}.
4. Гарантийный ремонт выполняется бесплатно.

Устройство получено и проверено в присутствии Заказчика. Работы выполнены в полном объёме, претензий к внешнему виду и работе устройства не имею.

Выдал: ____________________          Подпись Заказчика: ____________________`;

const VARS = [
  ['номер', 'номер заказа'], ['дата', 'дата приёма'], ['сервис', 'название сервиса («Эксперт»)'], ['организация', 'ИП / организация'],
  ['инн', 'ИНН'], ['клиент', 'ФИО клиента'], ['телефон', 'телефон клиента'], ['тип', 'тип устройства'], ['модель', 'марка и модель'],
  ['марка', 'марка (Apple, Samsung…)'], ['цвет', 'цвет'], ['внешний_вид', 'внешний вид, комплектация'], ['неисправность', 'неисправность'],
  ['примерная_цена', 'примерная цена'], ['цена', 'итоговая цена'], ['предоплата', 'внесено'], ['остаток', 'к оплате'],
  ['срок', 'срок ремонта'], ['гарантия', 'гарантия, мес.'], ['принял', 'кто принял'], ['мастер', 'кто ремонтирует'],
  ['адрес', 'адрес точки'], ['телефон_точки', 'телефон точки'], ['дата_выдачи', 'дата выдачи'],
  ['работы', 'запчасти и работы по заказу'], ['оплачено', 'всего оплачено'], ['способ_оплаты', 'нал / перевод / терминал'],
  ['гарантия_до', 'гарантия действует до'],
];
// Два бланка: [поле settings, заголовок, стандартный текст]
const BLANKS = [
  ['template', 'Бланк приёма (договор)', DEFAULT_TEMPLATE, 'Печатается при приёме устройства: кнопка «Бланк приёма» в карточке заказа.'],
  ['templateIssue', 'Акт выдачи и гарантийный талон', DEFAULT_ISSUE_TEMPLATE, 'Печатается при выдаче: CRM предложит его сразу после «Выдать клиенту», а также кнопка «Акт выдачи» в карточке выданного заказа.'],
];

const COUNT_NAMES = [['clients', 'Клиенты'], ['parts', 'Запчасти'], ['orders', 'Заказы'], ['orderParts', 'Запчасти в заказах'],
  ['payments', 'Оплаты'], ['cash', 'Записи кассы'], ['fines', 'Штрафы']];

// Состояние переноса живёт между перерисовками вкладки.
const imp = { file: '', json: null, info: null, mapping: { points: {}, names: {} }, running: false, progress: null, report: null, error: '' };

const pct = toPct; // 0.35 → 35
const salesPct = (v) => toPct(salesRate({ settings: [{ salesRate: v }] }));

export default {
  id: 'settings',
  title: 'Настройки',
  render(el, ctx) {
    const { store, ui, calc } = ctx;
    const { esc } = ui;
    const owner = store.isOwner;
    const dis = owner ? '' : 'disabled';
    const st = store.data.settings[0] || {};
    const points = store.data.points;
    const sp = salesPct(st.salesRate);

    const pointRows = points.map((p) => `<tr data-point="${esc(p.id)}">
        <td><input name="address" value="${esc(p.address || p.name)}" ${dis} aria-label="Адрес"></td>
        <td><input name="phone" type="tel" value="${esc(ui.fmtPhone(p.phone))}" placeholder="8 …" ${dis} aria-label="Телефон"></td>
        <td class="num"><input name="rate" type="number" min="0" max="100" step="0.5" value="${pct(p.rate)}" ${dis} aria-label="Ставка, %" class="pct"> %</td>
        ${owner ? '<td><button class="btn sm" data-save-point>Сохранить</button></td>' : ''}</tr>`).join('');

    el.innerHTML = `
      <div class="head"><h2>Настройки</h2></div>
      ${owner ? '' : '<p class="muted">Изменять настройки может только владелец. Здесь можно посмотреть текущие значения.</p>'}

      <div class="two">
        <section class="sect">
          <h3>Реквизиты для бланка</h3>
          <form id="reqForm" class="fields">
            <label class="full">Организация / ИП<input name="org" value="${esc(st.org)}" placeholder="ИП Фамилия И. О." ${dis}></label>
            <label>ИНН<input name="inn" value="${esc(st.inn)}" inputmode="numeric" ${dis}></label>
          </form>
          ${owner ? '<div class="actions"><button class="btn" id="reqSave">Сохранить реквизиты</button></div>' : ''}
          <p class="muted small">Пустые реквизиты печатаются в бланке как «____________».</p>
        </section>

        <section class="sect">
          <h3>Процент продавцу с продаж</h3>
          <form id="salesForm" class="fields">
            <label>Процент от прибыли продажи<span class="set-pct"><input name="sales" type="number" min="0" max="100" step="0.5" value="${sp}" ${dis} class="pct"> %</span></label>
          </form>
          ${sp ? '' : '<p><span class="chip accent">Укажите процент</span> <span class="muted small">Пока 0% — продавцу-мастеру за продажи ничего не начисляется.</span></p>'}
          <p class="muted small">Прибыль продажи = (цена − закупка) × количество. Владельцу процент не начисляется.</p>
          ${owner ? '<div class="actions"><button class="btn" id="salesSave">Сохранить процент</button></div>' : ''}
        </section>
      </div>

      <section class="sect">
        <h3>Забытые устройства</h3>
        <form id="forgotForm" class="fields">
          <label>Считать забытым, если «Готов» дольше<span class="set-pct set-days"><input name="days" type="number" min="1" max="365" step="1" value="${esc(calc.forgotDays(store.data))}" ${dis}> дн.</span></label>
        </form>
        <p class="muted small">Такие заказы подсвечиваются в «Заказах» и на «Главной»; в карточке есть кнопка «Напомнить клиенту». По умолчанию — 7 дней.</p>
        ${owner ? '<div class="actions"><button class="btn" id="forgotSave">Сохранить срок</button></div>' : ''}
      </section>

      <section class="sect">
        <h3>Услуги быстрого заказа</h3>
        <p class="muted small">Список в поле «Услуга» быстрого заказа — по одной услуге в строке, в нужном порядке. Новую можно добавить и прямо из быстрого заказа кнопкой «+ В список». Пустой список — вернутся стандартные.</p>
        <textarea id="svcList" rows="6" ${dis} aria-label="Услуги быстрого заказа">${esc(quickServices(store.data).join('\n'))}</textarea>
        ${owner ? '<div class="actions"><button class="btn" id="svcSave">Сохранить список</button></div>' : ''}
      </section>

      <section class="sect">
        <h3>Точки и ставки мастеров</h3>
        <p class="muted small">Ставка — доля мастера от прибыли заказа (цена − запчасти − курьер) на этой точке.</p>
        <div class="tw"><table>
          <thead><tr><th>Адрес</th><th>Телефон</th><th class="num">Ставка мастера</th>${owner ? '<th></th>' : ''}</tr></thead>
          <tbody>${pointRows}</tbody></table></div>
      </section>

      ${BLANKS.map(([f, title, , note]) => `<section class="sect" data-blank="${f}">
        <h3>${esc(title)}</h3>
        <p class="muted small">${esc(note)} Переменные в двойных фигурных скобках подставляются из заказа при печати.${owner ? ' Нажмите на переменную, чтобы вставить её в текст.' : ''}</p>
        <div class="set-vars">${VARS.map(([v, t]) => `<button type="button" class="chip btnlike" data-var="${esc(v)}" title="${esc(t)}" ${dis}>{{${esc(v)}}}</button>`).join('')}</div>
        <textarea class="tpl" rows="18" ${dis} aria-label="${esc(title)}">${esc(st[f] || '')}</textarea>
        ${owner ? `<div class="actions">
          <button class="btn ghost" data-tpl-reset>Вернуть стандартный</button>
          <button class="btn" data-tpl-save>Сохранить</button></div>` : ''}
      </section>`).join('')}

      ${owner ? `<section class="sect" id="importSect">
        <h3>Перенос из старой версии</h3>
        <div id="imp">${importHtml(store, ui)}</div>
      </section>` : ''}`;

    if (!owner) return;
    const save = async (btn, col, id, data, ok) => {
      try { await ui.busy(btn, store.update(col, id, data)); ui.toast(ok); } catch (err) { ui.showError(err); }
    };

    el.querySelector('#reqSave').addEventListener('click', (e) => {
      const d = ui.formData(el.querySelector('#reqForm'));
      save(e.currentTarget, 'settings', st.id, { org: d.org, inn: d.inn }, 'Реквизиты сохранены');
    });

    el.querySelector('#salesSave').addEventListener('click', (e) => {
      const v = Number(el.querySelector('#salesForm [name=sales]').value);
      if (!Number.isFinite(v) || v < 0 || v > 100) { ui.toast('Процент — число от 0 до 100', 'error'); return; }
      save(e.currentTarget, 'settings', st.id, { salesRate: fromPct(v) }, 'Процент сохранён');
    });

    el.querySelector('#forgotSave').addEventListener('click', (e) => {
      const v = Number(el.querySelector('#forgotForm [name=days]').value);
      if (!Number.isInteger(v) || v < 1 || v > 365) { ui.toast('Срок — целое число дней от 1 до 365', 'error'); return; }
      save(e.currentTarget, 'settings', st.id, { forgotDays: v }, 'Срок сохранён');
    });

    el.querySelector('#svcSave').addEventListener('click', (e) => {
      const list = el.querySelector('#svcList').value.split('\n').reduce((acc, line) => addService(acc, line), []);
      save(e.currentTarget, 'settings', st.id, { quickServices: list }, list.length ? `Список услуг сохранён: ${list.length}` : 'Список очищен — будут стандартные услуги');
    });

    // Enter в поле формы — то же, что кнопка «Сохранить» (без перезагрузки страницы).
    for (const [form, btn] of [['#reqForm', '#reqSave'], ['#salesForm', '#salesSave'], ['#forgotForm', '#forgotSave']]) {
      el.querySelector(form).addEventListener('submit', (e) => { e.preventDefault(); el.querySelector(btn).click(); });
    }

    el.querySelectorAll('[data-save-point]').forEach((b) => b.addEventListener('click', () => {
      const tr = b.closest('tr');
      const p = points.find((x) => x.id === tr.dataset.point);
      const address = tr.querySelector('[name=address]').value.trim();
      const phone = ui.fmtPhone(tr.querySelector('[name=phone]').value);
      const rate = Number(tr.querySelector('[name=rate]').value);
      if (!address) { ui.toast('Укажите адрес точки', 'error'); return; }
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) { ui.toast('Ставка — число от 0 до 100', 'error'); return; }
      const data = { address, phone, rate: fromPct(rate) };
      if (!p.name || p.name === p.address) data.name = address; // название точки следует за адресом
      save(b, 'points', p.id, data, 'Точка сохранена');
    }));

    for (const [f, title, def] of BLANKS) {
      const sec = el.querySelector(`[data-blank="${f}"]`);
      const tpl = sec.querySelector('.tpl');
      sec.querySelectorAll('[data-var]').forEach((b) => b.addEventListener('click', () => {
        const ins = `{{${b.dataset.var}}}`;
        const { selectionStart: s, selectionEnd: e } = tpl;
        tpl.setRangeText(ins, s ?? tpl.value.length, e ?? tpl.value.length, 'end');
        tpl.focus();
      }));
      sec.querySelector('[data-tpl-save]').addEventListener('click', (e) =>
        save(e.currentTarget, 'settings', st.id, { [f]: tpl.value }, `«${title}» сохранён`));
      sec.querySelector('[data-tpl-reset]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        if (!(await ui.confirmDlg(`Вернуть стандартный текст «${title}»? Ваши правки пропадут.`, { ok: 'Вернуть' }))) return;
        tpl.value = def;
        save(btn, 'settings', st.id, { [f]: def }, 'Стандартный текст восстановлен');
      });
    }

    bindImport(el.querySelector('#imp'), store, ui);
  },
};

// ---------- перенос ----------

function importHtml(store, ui) {
  const { esc } = ui;
  if (imp.running) {
    const p = imp.progress || { done: 0, total: 1, stage: 'Подготовка' };
    const w = Math.round((p.done / Math.max(1, p.total)) * 100);
    return `<p>Идёт перенос — не закрывайте страницу.</p>
      <div class="bar"><span class="n">${esc(p.stage)}</span><span class="t"><i style="width:${w}%"></i></span><span class="x">${p.done} из ${p.total}</span></div>`;
  }
  if (imp.report) return reportHtml(imp.report, ui);

  const intro = `<p class="muted small">В старой версии откройте «Настройки» → «Экспорт в файл» и выберите этот файл.
    Повторный перенос того же файла не создаёт дублей — уже перенесённые записи пропускаются.</p>
    <label class="btn ghost set-file">Выбрать файл…<input type="file" id="impFile" accept=".json,application/json" hidden></label>
    ${imp.file ? `<span class="muted small"> ${esc(imp.file)}</span>` : ''}
    ${imp.error ? `<p class="err">${esc(imp.error)}</p>` : ''}`;
  if (!imp.info) return intro;

  const { counts, points: oldPoints, names } = imp.info;
  const users = store.data.users;
  const pointsSel = oldPoints.map((p) => `<label>Старая точка «${esc(p)}» <span class="neg">*</span>
      <select data-map-point="${esc(p)}" class="${imp.mapping.points[p] ? '' : 'bad'}"><option value="">— выберите адрес —</option>${ui.options(store.data.points, imp.mapping.points[p], (x) => x.address || x.name)}</select></label>`).join('');
  const namesSel = names.map((n) => `<label>«${esc(n)}»
      <select data-map-name="${esc(n)}"><option value="">оставить только имя</option>${ui.options(users, imp.mapping.names[n] || '', (u) => u.name || u.email)}</select></label>`).join('');
  const ready = oldPoints.every((p) => imp.mapping.points[p]);

  return `${intro}
    <h4>Найдено в файле</h4>
    <div class="tw"><table><tbody>
      ${COUNT_NAMES.map(([k, t]) => `<tr><td>${t}</td><td class="num">${counts[k]}</td></tr>`).join('')}
      ${counts.shifts ? `<tr class="off"><td>Смены</td><td class="num">${counts.shifts} — не переносятся (раздел убран)</td></tr>` : ''}
    </tbody></table></div>
    ${oldPoints.length ? `<h4>Точки — обязательно</h4><div class="fields">${pointsSel}</div>` : ''}
    ${names.length ? `<h4>Мастера</h4><p class="muted small">Сопоставьте имена из старой версии с учётными записями — тогда заказы, выплаты и штрафы попадут в статистику сотрудника. Сотрудников добавляют во вкладке «Сотрудники».</p><div class="fields">${namesSel}</div>` : ''}
    <div class="actions"><button class="btn" id="impRun" ${ready ? '' : 'disabled'}>Перенести</button></div>
    ${ready ? '' : '<p class="muted small">Выберите адрес для каждой старой точки.</p>'}`;
}

function reportHtml(r, ui) {
  const { esc } = ui;
  const rows = COUNT_NAMES.map(([k, t]) => `<tr><td>${t}</td><td class="num">${r.created[k]}</td><td class="num">${r.skipped[k]}</td></tr>`).join('');
  return `<p><span class="chip ${r.errors.length ? 'bad' : 'ok'}">${r.errors.length ? `Перенос завершён, ошибок: ${r.errors.length}` : 'Перенос завершён без ошибок'}</span></p>
    <div class="tw"><table><thead><tr><th></th><th class="num">Перенесено</th><th class="num">Уже были</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${r.notes.length ? `<ul class="set-notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    ${r.errors.length ? `<h4>Не перенесено</h4><div class="tw"><table><tbody>${r.errors.map((e) => `<tr><td>${esc(e.what)}</td><td class="neg">${esc(e.text)}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted small">Исправьте причину и запустите перенос того же файла ещё раз — перенесутся только недостающие записи.</p>` : ''}
    <div class="actions"><button class="btn ghost" id="impAgain">Перенести другой файл</button></div>`;
}

function bindImport(box, store, ui) {
  const redraw = () => repaint(store, ui);

  box.querySelector('#impFile')?.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    Object.assign(imp, { file: f.name, json: null, info: null, error: '', report: null, mapping: { points: {}, names: {} } });
    try {
      const json = JSON.parse(await f.text());
      imp.info = analyze(json);
      imp.json = json;
      // имена, совпадающие с сотрудниками, сопоставляем сразу
      const low = (s) => String(s || '').trim().toLowerCase();
      for (const n of imp.info.names) {
        const u = store.data.users.find((x) => low(x.name) === low(n));
        if (u) imp.mapping.names[n] = u.id;
      }
    } catch (err) {
      imp.error = err instanceof SyntaxError ? 'Не удалось прочитать файл: это не JSON.' : err.message;
    }
    redraw();
  });

  box.querySelectorAll('[data-map-point]').forEach((s) => s.addEventListener('change', () => {
    imp.mapping.points[s.dataset.mapPoint] = s.value;
    redraw();
  }));
  box.querySelectorAll('[data-map-name]').forEach((s) => s.addEventListener('change', () => {
    imp.mapping.names[s.dataset.mapName] = s.value;
  }));

  box.querySelector('#impAgain')?.addEventListener('click', () => {
    Object.assign(imp, { file: '', json: null, info: null, report: null, error: '', progress: null, mapping: { points: {}, names: {} } });
    redraw();
  });

  box.querySelector('#impRun')?.addEventListener('click', async () => {
    if (!(await ui.confirmDlg('Перенести данные из файла в CRM? Это может занять несколько минут.', { ok: 'Перенести', danger: false }))) return;
    imp.running = true;
    imp.progress = null;
    redraw();
    const api = sdkApi(store.pb, (fn) => store.request(fn));
    let last = 0;
    try {
      imp.report = await run(imp.json, imp.mapping, (p) => {
        imp.progress = p;
        const now = Date.now();
        if (now - last > 200 || p.done === p.total) { last = now; repaint(store, ui); }
      }, api);
      imp.json = null;
      store.load().catch(() => {});
    } catch (err) {
      imp.error = ui.errorText(err);
    } finally {
      imp.running = false;
      repaint(store, ui);
    }
  });
}

// Перерисовать блок переноса в актуальном контейнере (вкладку могли перерисовать по данным).
function repaint(store, ui) {
  const cur = document.getElementById('imp');
  if (!cur) return;
  cur.innerHTML = importHtml(store, ui);
  bindImport(cur, store, ui);
}
