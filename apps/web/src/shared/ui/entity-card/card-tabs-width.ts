/**
 * Solver ширины карточки с областями вкладок (#746) — чистая функция.
 *
 * Принцип: храним ПРЕДПОЧТЕНИЯ пользователя, а не текущую отрисовку. При
 * нехватке места уступаем строго по очереди (research: VS Code/split panes,
 * Nib ADR 0238 — вторичные колонки уступают первыми):
 *   1) навигатор ветки сворачивается;
 *   2) лента чата 470→280 (при открытой панели беседы);
 *   3) вторая (не чатовая) область 470→280;
 *   4) панель данных 340→320;
 *   5) вторая область временно сворачивается (derived, prefs не пишутся);
 *   6) панель беседы временно скрывается (derived, prefs не пишутся).
 * Панель вложений не сжимается: 300/360 целиком либо временно скрыта.
 * При расширении всё возвращается к предпочтениям.
 */

export const CARD_TAB_WIDTH = {
  /** Панель данных: минимум и предпочтение. */
  dataMin: 320,
  dataPref: 340,
  /** Чат: без панели / с панелью беседы. */
  chatMin: 420,
  chatMinWithPanel: 280,
  chatPref: 470,
  /** Вторая (не чатовая) вкладка. */
  groupMin: 280,
  groupPref: 470,
  /** Панель беседы: письмо/проект и задача («О задаче»). */
  panelW: 300,
  taskPanelW: 360,
  /** Навигатор ветки — сворачивается первым. */
  branchW: 300,
  /** Перегородка — оверлей поверх границы (как ручки карточек): трек не
   *  съедает ширину, поэтому пороги таблицы считаются без зазора. */
  splitterW: 0,
} as const;

export interface SolveWidthGroup {
  id: string;
  /** Чат-область не сворачивается: панель беседы привязана к ней. */
  isChat: boolean;
  /** Предпочтение пользователя (px); нет — groupPref/chatPref. */
  prefW?: number;
}

export interface SolveCardWidthsInput {
  /** Ширина ряда без навигатора ветки (или включая его при branchOpen). */
  rowWidth: number;
  groups: readonly SolveWidthGroup[];
  /** Панель данных (задача/письмо); 0/нет — проект без статичной панели. */
  dataEnabled?: boolean;
  dataPref?: number;
  dataMin?: number;
  /** Панель беседы открыта пользователем (предпочтение, не отрисовка). */
  panelOpen?: boolean;
  panelW?: number;
  /** Навигатор ветки: учитывается как первая уступка. */
  branchOpen?: boolean;
  branchW?: number;
  maxGroups?: number;
}

export interface SolveCardWidthsResult {
  dataW: number;
  /** Ширины по исходным группам; свёрнутая — 0. */
  groupW: number[];
  panelW: number;
  branchW: number;
  /** Временно свёрнутая (derived) область; в prefs не пишется. */
  collapsedGroupId: string | null;
  /** Панель беседы отрисована; false — временно скрыта из-за ширины. */
  panelRendered: boolean;
  /** Суммарно занято (≤ rowWidth, кроме физически невозможных ширин). */
  totalW: number;
}

interface WorkGroup {
  group: SolveWidthGroup;
  /** Индекс в исходном массиве (groupW выравнивается по нему). */
  index: number;
  width: number;
}

/**
 * Решение ширин. Мутаций входа нет; предпочтения (`prefW`) не меняются.
 * `collapsedGroupId`/`panelRendered` — derived-состояния: вызывающий код
 * НЕ сохраняет их в prefs.
 */
export function solveCardWidths(input: SolveCardWidthsInput): SolveCardWidthsResult {
  const rowWidth = Math.max(0, input.rowWidth);
  const dataEnabled = input.dataEnabled ?? (input.dataMin ?? 0) > 0;
  const dataMin = dataEnabled ? (input.dataMin ?? CARD_TAB_WIDTH.dataMin) : 0;
  const dataPref = dataEnabled ? Math.max(dataMin, input.dataPref ?? CARD_TAB_WIDTH.dataPref) : 0;
  const panelPref = input.panelOpen ? (input.panelW ?? CARD_TAB_WIDTH.panelW) : 0;
  const branchPref = input.branchOpen ? (input.branchW ?? CARD_TAB_WIDTH.branchW) : 0;
  const maxGroups = Math.max(1, input.maxGroups ?? 2);

  const allGroups = input.groups.slice(0, maxGroups);
  const panelVisible = panelPref > 0;
  const minOf = (group: SolveWidthGroup, withPanel: boolean): number => {
    if (group.isChat) {
      return withPanel ? CARD_TAB_WIDTH.chatMinWithPanel : CARD_TAB_WIDTH.chatMin;
    }
    return CARD_TAB_WIDTH.groupMin;
  };
  const prefOf = (group: SolveWidthGroup): number =>
    Math.max(
      minOf(group, panelVisible),
      group.prefW ?? (group.isChat ? CARD_TAB_WIDTH.chatPref : CARD_TAB_WIDTH.groupPref),
    );

  let dataW = dataPref;
  let panelW = panelPref;
  let branchW = branchPref;
  let panelRendered = panelVisible;
  let collapsedGroupId: string | null = null;
  let live: WorkGroup[] = allGroups.map((group, index) => ({
    group,
    index,
    width: prefOf(group),
  }));

  const gaps = () => (live.length > 1 ? CARD_TAB_WIDTH.splitterW * (live.length - 1) : 0);
  const total = () =>
    branchW + dataW + panelW + gaps() + live.reduce((sum, entry) => sum + entry.width, 0);

  // Ограниченное число проходов: каждая уступка монотонно уменьшает сумму.
  for (let pass = 0; pass < 12; pass += 1) {
    const over = total() - rowWidth;
    if (over <= 0) {
      // Остаток отдаём последней области — карточка заполнена целиком.
      const last = live[live.length - 1];
      if (last) last.width += -over;
      break;
    }

    let deficit = over;

    // 1. Навигатор ветки — сворачивается первым.
    if (deficit > 0 && branchW > 0) {
      const take = Math.min(deficit, branchW);
      branchW -= take;
      deficit -= take;
      if (deficit <= 0) continue;
    }

    // 2. Чат 470→280 (с панелью) / 470→420 (без неё).
    for (const entry of live.filter((item) => item.group.isChat)) {
      if (deficit <= 0) break;
      const min = minOf(entry.group, panelRendered);
      const take = Math.min(deficit, Math.max(0, entry.width - min));
      entry.width -= take;
      deficit -= take;
    }
    if (deficit <= 0) continue;

    // 3. Нечатовые области 470→280.
    for (const entry of live.filter((item) => !item.group.isChat)) {
      if (deficit <= 0) break;
      const min = minOf(entry.group, panelRendered);
      const take = Math.min(deficit, Math.max(0, entry.width - min));
      entry.width -= take;
      deficit -= take;
    }
    if (deficit <= 0) continue;

    // 4. Панель данных 340→320.
    if (deficit > 0 && dataW > dataMin) {
      const take = Math.min(deficit, dataW - dataMin);
      dataW -= take;
      deficit -= take;
      if (deficit <= 0) continue;
    }

    // 5. Вторая область — временно свернуть (чат-область не трогаем).
    if (deficit > 0 && live.length > 1) {
      const chatEntries = live.filter((entry) => entry.group.isChat);
      const victim =
        chatEntries.length === 1
          ? live.find((entry) => !entry.group.isChat)!
          : live[live.length - 1]!;
      collapsedGroupId = victim.group.id;
      victim.width = 0;
      live = live.filter((entry) => entry !== victim);
      // Свёрнутая область освобождает место — панель данных возвращается к
      // предпочтению (таблица: 1000 → данные 340, чат 360). Если не влезает,
      // следующий проход снова уступит данные до минимума.
      dataW = dataPref;
      continue;
    }

    // 6. Панель беседы — временно скрыть, вернуть предпочтения и пересчитать.
    if (deficit > 0 && panelW > 0) {
      panelW = 0;
      panelRendered = false;
      dataW = dataPref;
      live = live.map((entry) => ({ ...entry, width: prefOf(entry.group) }));
      continue;
    }

    // Физически невозможно (окно уже минимума): не раздуваем ряд — отдаём
    // остаток области, карточка клипует. Горизонтального скролла нет.
    break;
  }

  const groupW = allGroups.map(() => 0);
  for (const entry of live) groupW[entry.index] = Math.round(entry.width);
  return {
    dataW: Math.round(dataW),
    groupW,
    panelW: Math.round(panelW),
    branchW: Math.round(branchW),
    collapsedGroupId,
    panelRendered,
    totalW: Math.round(
      branchW + dataW + panelW + gaps() + live.reduce((sum, entry) => sum + entry.width, 0),
    ),
  };
}

/** Проекция solver'а на две области (для UI/тестов): ratio первой группы. */
export function groupRatios(result: SolveCardWidthsResult): number[] {
  const live = result.groupW.filter((width) => width > 0);
  const sum = live.reduce((acc, width) => acc + width, 0);
  return sum > 0 ? live.map((width) => width / sum) : [];
}

/** Панель беседы не сжимается: либо целая, либо скрыта. */
export function panelIsWhole(result: SolveCardWidthsResult, expected: number): boolean {
  return result.panelW === 0 || result.panelW >= expected;
}
