// >300 строк — обоснование (I5): ПУБЛИЧНОЕ API каркаса для фич
// (patterns.md: из app/shell фичам разрешён только этот файл —
// CIRCUIT_REMEASURE, measureCircuit у страницы сотрудников). Замер DOM
// (measureCircuit/measureCardCircuit) и построение пути/фокуса/вспышки
// (framePath/currentFocus/transitionPulse) делят один тип CircuitGeometry и
// константы засечек (TAB_DOT_DY); разнос по файлам дробил бы публичный
// контракт на несколько разрешённых путей импорта. Функции чистые и покрыты
// circuit-geometry.test.ts.
import { orthPath, snapPx, type NodeEdgePoint } from '@nodus/ui/components/node-edge';

import { navModuleForPath } from './nav-registry.js';
import { RAIL_TRUNK_X, MODULE_PORT_R } from './node-rail.js';

/** Custom-событие «перемерь контур»: его шлёт хром, который меняется БЕЗ
 *  route/resize (вкладки фулскрин-карточки мессенджера — `MessengerTabs`),
 *  после коммита нового `data-active` в DOM. */
export const CIRCUIT_REMEASURE = 'nodus:circuit-remeasure';

/** Измеренная геометрия контура: порты из DOM по data-атрибутам. */
export interface CircuitGeometry {
  /** Стык шины рейки и оси шапки (корень контура). */
  junction: NodeEdgePoint;
  /** Y оси бордюра шапки. */
  axisY: number;
  /** Y точек подмодулей: СРАЗУ под названием вкладки (центр топбара + половина
   *  строки подписи + зазор), НЕ фикс-отступ от оси — вердикт раунда 3:
   *  «большой отступ между точкой прихода связи и названием подмодуля». */
  tabY: number;
  modules: { to: string; active: boolean; port: NodeEdgePoint }[];
  /** Центры вкладок топбара (x), активность, подпись (идентичность вкладки). */
  tabs: { active: boolean; x: number; label: string }[];
  /** Узел схлопнутой левой рейки (точка на её боковом шве; null — рейка развёрнута). */
  leftNode: NodeEdgePoint | null;
  /** Правый край = правый край мягкой рамы (`data-soft-frame`): служебная
   * полоса живёт ЗА пределами рамы (план R4/R5), ось доходит только до
   * границы мягкой области и не пересекает зону аватарок. При раскрытии
   * полосы рама сужается — ось следует за её краем (пересчёт
   * покадрово, слушатель transition width в circuit-frame). */
  rightEdge: number;
  /** Ось на всю ширину рамы — ТОЛЬКО в мессенджере: там она одновременно
   * верхняя граница окна чата (вердикт владельца 14.09.2026 вечером: «чат
   * без верхнего бордера не представляю»). В остальных модулях ось —
   * связь модуль→подмодули и заканчивается дугой в засечку последней
   * вкладки (без хвостов и зазоров). */
  axisFull: boolean;
  /** Терминальная точка модуля БЕЗ подмодулей (Главная развёрнутая): шина
   * поднимается до линии шапки и заканчивается узлом, как узел схлопнутой
   * рейки. null — есть вкладки или узел схлопнутой рейки уже рисуется. */
  terminus: NodeEdgePoint | null;
  /** Низ шины рейки (центр последнего модуля). */
  spineEndY: number;
  /** Режим ПОЛНОЭКРАННОЙ карточки мессенджера (план messenger-fullscreen):
   *  геометрия измерена по хедеру карточки (`data-card-topbar`), а не шелла;
   *  шина — урезанная (как у схлопнутой левой рейки): от точки на левой
   *  границе карточки по оси до её правого края. Контур рисуется ПОверх
   *  карточки (z-[60] > z-50 слайдера), узел-точка — на тоне карточки. */
  cardMode: boolean;
}

/** Фокус навигации: активный модуль и вкладка (для вспышки-перехода). */
export interface CircuitFocus {
  moduleTo: string;
  modulePort: NodeEdgePoint;
  /** Подпись активной вкладки — идентичность (не x: сдвиг геометрии при
   * сворачивании панелей/resize фокусом не является и вспышки не вызывает). */
  tabLabel: string | null;
}

function centerOf(el: Element): NodeEdgePoint {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Подпись вкладки — только метка (`data-tab-label`), БЕЗ счётчика
 *  непрочитанных (#409): число живёт в отдельном бейдже и не должно менять
 *  сигнатуру фокуса — иначе каждый новый unread давал бы ложную вспышку. */
function tabLabelOf(el: HTMLElement): string {
  return (
    el.querySelector<HTMLElement>('[data-tab-label]')?.textContent?.trim() ??
    el.textContent?.trim() ??
    ''
  );
}

/** Маршрут виртуального модуля (схлопнутая рейка/режим карточки): базовый
 *  путь модуля по реестру — совпадает с data-module-port порта развёрнутой
 *  рейки, чтобы сигнатура фокуса не менялась на сворачивание (#235). */
function activeModuleTo(pathname: string): string {
  return navModuleForPath(pathname)?.to ?? pathname;
}

/** Измерение контура из живого DOM. Возвращает null, если каркас не смонтирован.
 *  `cardMode` — вершина стека карточек: полноэкранная карточка мессенджера
 *  (шина шелла под ней невидима — измеряется контур самой карточки). */
export function measureCircuit(pathname = '/', cardMode = false): CircuitGeometry | null {
  if (cardMode) return measureCardCircuit(pathname);
  const header = document.querySelector<HTMLElement>('[data-topbar]');
  if (!header) return null;
  const headerRect = header.getBoundingClientRect();
  const axisY = headerRect.bottom;
  const tabY = snapPx(axisY - headerRect.height / 2 + TAB_DOT_DY);
  const modules = [...document.querySelectorAll<HTMLElement>('[data-module-port]')].map((el) => ({
    to: el.dataset.modulePort ?? '',
    active: el.dataset.active === 'true',
    port: centerOf(el),
  }));
  // Вкладки — ТОЛЬКО из топбара шелла: глобальный запрос ловил порты вкладок
  // закрывающейся фулскрин-карточки (на wake-замере она ещё в DOM) — после
  // закрытия слайдера на основном окне оставались «отростки» засечек (баг #91).
  // Подпись — только метка, без счётчика непрочитанных (tabLabelOf).
  const tabs = [...header.querySelectorAll<HTMLElement>('[data-tab-port]')].map((el) => ({
    active: el.dataset.active === 'true',
    x: centerOf(el).x,
    label: tabLabelOf(el),
  }));
  const leftEl = document.querySelector<HTMLElement>('[data-left-node]');
  // Узел шва ЛЕЖИТ на оси шапки по определению — DOM-якорь рейки даёт только X.
  // Его рем-вертикаль плывёт на дробном UI-масштабе (×1.25: 63×1.25+1 = 79.75
  // против оси 80) и точка сходила с линии на физический пиксель (#851).
  const leftNode = leftEl ? { x: centerOf(leftEl).x, y: axisY } : null;
  // Правый край оси = правый край мягкой рамы: служебная полоса (профиль +
  // коллеги) живёт ЗА пределами рамы в правом периметре (план R4/R5) — связь
  // не пересекает зону аватарок; раскрытие полосы (кнопка-шевроны) сужает
  // раму, и ось идёт за её краем покадрово.
  const frameEl = document.querySelector<HTMLElement>('[data-soft-frame]');
  const frameRect = frameEl?.getBoundingClientRect();
  const lastY = modules.length ? Math.max(...modules.map((m) => m.port.y)) : axisY;
  // Схлопнутая рейка: стык — правый край узла бокового шва (точка 5px);
  // «виртуальный» активный модуль опирает вспышки на ось (портов внутри
  // панели нет); to — БАЗОВЫЙ маршрут модуля (как data-module-port у порта
  // развёрнутой рейки), НЕ полный pathname: на вложенных маршрутах
  // (/chat/<id>) сигнатура фокуса дёргалась на каждое сворачивание и
  // запускала запрещённую вспышку (#235).
  const junction: NodeEdgePoint = leftNode
    ? { x: leftNode.x + 2.5, y: axisY }
    : { x: RAIL_TRUNK_X, y: axisY };
  return {
    junction,
    axisY,
    tabY,
    modules: leftNode ? [{ to: activeModuleTo(pathname), active: true, port: junction }] : modules,
    tabs,
    leftNode,
    rightEdge: frameRect ? frameRect.right : document.documentElement.clientWidth,
    // Окна-сплиты (мессенджер, Автоматизация — флаг реестра навигации): ось =
    // ещё и верхняя граница окна — на всю ширину рамы; остальные модули:
    // связь до последнего подмодуля (вердикт 14.09.2026).
    axisFull: navModuleForPath(pathname)?.splitWindow === true,
    // Главная (подмодулей нет): связь доводится до ЛЕВОГО КРАЯ мягкой области
    // и заканчивается на нём терминальной точкой (вердикт владельца вечером
    // 14.09.2026: «довести связь до мягкой области и там в точку
    // законнектиться»); у схлопнутой рейки эту роль играет её узел шва.
    terminus: !leftNode && tabs.length === 0 ? { x: frameRect?.left ?? 0, y: axisY } : null,
    // Шина заканчивается в точке отхода последнего отвода (порт-10) — без хвоста.
    spineEndY: leftNode ? axisY : modules.length ? lastY - 10 : axisY,
    cardMode: false,
  };
}

/**
 * Контур ПОЛНОЭКРАННОЙ карточки мессенджера (план messenger-fullscreen,
 * вердикт владельца 15.09.2026; реф — урезанная шина схлопнутой левой рейки):
 * левый узел-точка — на левой границе мягкой области карточки на оси вкладок;
 * ось идёт до правого края карточки (`axisFull`: в мессенджере она же верхняя
 * граница окна чата); засечки вверх — к точкам вкладок хедера карточки
 * (`data-tab-port` внутри `data-card-topbar`). Вкладки — локальное состояние
 * карточки (не URL): перемер по custom-событию `CIRCUIT_REMEASURE`.
 * null, пока хедер карточки не смонтирован.
 */
function measureCardCircuit(pathname: string): CircuitGeometry | null {
  const header = document.querySelector<HTMLElement>('[data-card-topbar]');
  const card = header?.closest<HTMLElement>('[role="dialog"]');
  if (!header || !card) return null;
  const headerRect = header.getBoundingClientRect();
  const axisY = headerRect.bottom;
  const tabY = snapPx(axisY - headerRect.height / 2 + TAB_DOT_DY);
  const cardRect = card.getBoundingClientRect();
  const leftNode: NodeEdgePoint = { x: cardRect.left, y: axisY };
  // Виртуальный активный модуль опирает вспышки на ось (портов рейки под
  // карточкой нет) — приём схлопнутой рейки; to — базовый маршрут модуля
  // (стабильная сигнатура, #235).
  const junction: NodeEdgePoint = { x: leftNode.x + 2.5, y: axisY };
  const tabs = [...header.querySelectorAll<HTMLElement>('[data-tab-port]')].map((el) => ({
    active: el.dataset.active === 'true',
    x: centerOf(el).x,
    label: tabLabelOf(el),
  }));
  return {
    junction,
    axisY,
    tabY,
    modules: [{ to: activeModuleTo(pathname), active: true, port: junction }],
    tabs,
    leftNode,
    rightEdge: cardRect.right,
    axisFull: true,
    terminus: null,
    spineEndY: axisY,
    cardMode: true,
  };
}

/** Статичный контур: связь модуль→подмодули (вердикт владельца 14.09.2026
 * вечером: длинного бордюра на всю ширину НЕТ — воздушность). Шина рейки
 * поднимается до линии шапки и идёт осью до ПОСЛЕДНЕГО подмодуля, где
 * аккуратной дугой (скруглённый угол orthPath) поворачивает ВВЕРХ в его
 * засечку — связь заканчивается узлом, ничего не торчит и нет зазора
 * (ошибка прошлого раунда: «хвостики» от обрезанного бордюра). Засечки
 * остальных вкладок — чистые вертикали, стоящие НА оси (низ засечки внутри
 * строки оси — шва не видно). ИСКЛЮЧЕНИЕ — мессенджер (`axisFull`): там ось
 * одновременно верхняя граница окна чата и идёт до правого края рамы.
 * Модуль без подмодулей (Главная): связь доводится до ЛЕВОГО КРАЯ мягкой
 * области и заканчивается на нём терминальной точкой (geo.terminus рисует
 * circuit-frame; вердикт владельца вечером 14.09.2026). Отводы модулей — локтями. */
export function framePath(g: CircuitGeometry): string {
  // Прямые сегменты — по снапнутым координатам (см. snapPx): одинаковая
  // чёткость/яркость всех линий на любом DPR/зуме.
  const jx = snapPx(g.junction.x);
  const ay = snapPx(g.axisY);
  const tickY = snapPx(g.tabY);
  const parts: string[] = [];
  const spineStartY = g.leftNode ? ay : g.modules.length > 0 ? snapPx(g.spineEndY) : ay;
  const tabsX = g.tabs.map((t) => snapPx(t.x));
  const lastX = tabsX.length ? Math.max(...tabsX) : null;
  if (lastX !== null) {
    // Ось и засечка последней вкладки — ОДНА ломаная: угол стыка скругляется
    // orthPath'ом (та же дуга, что на локтях шины) — без хвоста за вкладкой и
    // без зазора между осью и засечкой.
    const axisEnd = g.axisFull ? snapPx(g.rightEdge) : lastX;
    const points: NodeEdgePoint[] = [];
    if (spineStartY !== ay) points.push({ x: jx, y: spineStartY });
    points.push({ x: jx, y: ay }, { x: axisEnd, y: ay });
    if (!g.axisFull) points.push({ x: lastX, y: tickY });
    parts.push(orthPath(points, 8));
    // Засечки остальных подмодулей — локти с коротким подходом СЛЕВА ПО ОСИ:
    // угол входа вертикали в ось скруглён (радиус 6), как локти вспышки;
    // голая вертикаль на оси читалась «прямоугольным углом» рядом со
    // скруглением вспышки (вердикт владельца вечером 14.09.2026). Подход
    // сливается с осью (та же линия) и отдельно не виден.
    for (const tx of tabsX) {
      if (!g.axisFull && tx === lastX) continue;
      parts.push(
        orthPath(
          [
            { x: tx - 10, y: ay },
            { x: tx, y: ay },
            { x: tx, y: tickY },
          ],
          6,
        ),
      );
    }
  } else {
    // Подмодулей нет (Главная): шина поднимается до линии шапки, и связь
    // доводится до ЛЕВОГО КРАЯ мягкой области, где заканчивается терминальной
    // точкой (geo.terminus рисует circuit-frame) — плоского среза нет.
    const points: NodeEdgePoint[] = [];
    if (spineStartY !== ay) points.push({ x: jx, y: spineStartY });
    points.push({ x: jx, y: ay });
    if (g.terminus) points.push({ x: snapPx(g.terminus.x), y: ay });
    parts.push(orthPath(points, 8));
  }
  for (const m of g.modules) {
    // Отвод рисуем, только если порт вынесен от шины (у схлопнутой рейки
    // и виртуального модуля отвода нет).
    if (m.port.x - g.junction.x < 8) continue;
    const py = snapPx(m.port.y);
    parts.push(
      orthPath(
        [
          { x: jx, y: py - 10 },
          { x: jx, y: py },
          // Конец — В КРОМКЕ круга порта (кольцо бордюра 1px: r − 0.5…r):
          // не внутри (прозрачная сердцевина линию покажет) и не с зазором;
          // кромка и линия одного тона (--edge) — шов невидим (вердикт
          // владельца 15.09.2026).
          { x: m.port.x - (MODULE_PORT_R - 0.5), y: py },
        ],
        8,
      ),
    );
  }
  return parts.filter(Boolean).join(' ');
}

/** Смещение точки подмодуля ОТ ЦЕНТРА топбара вниз: половина строки подписи
 *  вкладки (16px/24px → 12px) + зазор 6px — точка сидит сразу под названием,
 *  а не в фикс-отступе от оси (вердикт раунда 3 #60). px фиксирован, как
 *  типографика: масштаб меняет высоту топбара, но не близость точки к тексту. */
export const TAB_DOT_DY = 18;

/** Текущий фокус навигации (активные модуль и вкладка). */
export function currentFocus(g: CircuitGeometry): CircuitFocus | null {
  const active = g.modules.find((m) => m.active);
  if (!active) return null;
  const activeTab = g.tabs.find((t) => t.active);
  return { moduleTo: active.to, modulePort: active.port, tabLabel: activeTab?.label ?? null };
}

/**
 * Вспышка-переход — строго один пульс в одну сторону, всегда ОТ ПОРТА МОДУЛЯ:
 * по шине и оси к точке активной вкладки (клик по модулю и клик по вкладке —
 * одна и та же траектория, пересечений нет по построению); у модуля без
 * вкладок — поворот за стык и затухание на оси без точки. Логотип не участвует.
 * dot=true — на конце пульса точка в целевом порту; false — без точки (стык).
 */
export function transitionPulse(
  g: CircuitGeometry,
  prev: CircuitFocus | null,
): { points: NodeEdgePoint[]; dot: boolean } | null {
  const active = g.modules.find((m) => m.active);
  if (!active) return null;
  const activeTab = g.tabs.find((t) => t.active);
  const focusChanged =
    !prev || prev.moduleTo !== active.to || prev.tabLabel !== (activeTab?.label ?? null);
  if (!focusChanged) return null;
  if (activeTab) {
    return {
      points: [
        { x: active.port.x, y: snapPx(active.port.y) },
        { x: snapPx(g.junction.x), y: snapPx(active.port.y) },
        { x: snapPx(g.junction.x), y: snapPx(g.axisY) },
        { x: snapPx(activeTab.x), y: snapPx(g.axisY) },
        { x: snapPx(activeTab.x), y: snapPx(g.tabY) },
      ],
      dot: true,
    };
  }
  // Главная: вспышка идёт до ТЕРМИНАЛЬНОЙ точки на левом краю мягкой области
  // (вердикт владельца 15.09.2026 — заменил «Главная без вспышки»: вспышка
  // есть и доходит до мягкой карточки, а не обрывается на стыке).
  if (active.to === '/home') {
    // СХЛОПНУТАЯ рейка (terminus null): связи на Главной нет — вспышка
    // ЗАПРЕЩЕНА вместе с узлом-точкой (баг-вердикт 15.09.2026).
    if (!g.terminus) return null;
    const endX = g.terminus.x;
    return {
      points: [
        { x: active.port.x, y: snapPx(active.port.y) },
        { x: snapPx(g.junction.x), y: snapPx(active.port.y) },
        { x: snapPx(g.junction.x), y: snapPx(g.axisY) },
        { x: snapPx(endX), y: snapPx(g.axisY) },
      ],
      dot: g.terminus !== null,
    };
  }
  // Модуль без вкладок: от порта по шине, за стык и затухание на оси без точки.
  return {
    points: [
      { x: active.port.x, y: snapPx(active.port.y) },
      { x: snapPx(g.junction.x), y: snapPx(active.port.y) },
      { x: snapPx(g.junction.x), y: snapPx(g.axisY) },
      { x: snapPx(g.junction.x) + 24, y: snapPx(g.axisY) },
    ],
    dot: false,
  };
}
