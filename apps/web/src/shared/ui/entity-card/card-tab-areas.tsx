import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { CARD_TAB_WIDTH } from './card-tabs-width.js';
import { CardTabDndLayer } from './card-tab-dnd-layer.js';
import { CardWidthHint } from './card-width-hint.js';
import { CardTabPanelLayer } from './card-tab-panel-layer.js';
import { useCardTabApply } from './use-card-tab-apply.js';
import { useCardTabGeometry } from './use-card-tab-geometry.js';
import { useCardTabKeyboard } from './use-card-tab-keyboard.js';
import {
  activateTab,
  mergeGroups,
  type CardTabGroup,
  type CardTabsState,
} from './card-tabs-model.js';
import { CardTabContextMenu } from './card-tab-context-menu.js';
import type { CardTabMenuState } from './card-tab-menu.js';
import { CardTabSplitter } from './card-tab-splitter.js';
import type { CardTabDef } from './card-tab-strip.js';
import { CardTabStripRow } from './card-tab-strip-row.js';
import { useCardTabDrag } from './use-card-tab-drag.js';

export interface CardTabAreasProps {
  /** Видимые вкладки (системные + открытые файлы) с подписями/иконками. */
  tabs: CardTabDef[];
  state: CardTabsState;
  onStateChange: (next: CardTabsState) => void;
  /** Сплит (кнопка/меню/DnD) с коммитом 50/50 по ширине рабочей зоны. */
  onSplitTab?: (next: CardTabsState, areaWidth: number) => void;
  /** Содержимое вкладки; рендерится ОДИН раз на карточку и переезжает
   *  между областями без ремаунта (стабильные key/позиция). */
  renderPanel: (tabId: string) => ReactNode;
  label: string;
  /** Ширины областей из solver'а (по state.groups); свёрнутая — 0. */
  groupW?: number[];
  collapsedGroupId?: string | null;
  /** Перегородка: коммит предпочтений пользователя (px обеих областей). */
  onGroupWidthsChange?: (widths: number[]) => void;
  /** Правый слот полосы (PanelRight/меню) — на каждую область. */
  actions?: (group: CardTabGroup, active: CardTabDef | undefined) => ReactNode;
  /** «+» личного набора — за вкладками области. */
  trailing?: (group: CardTabGroup) => ReactNode;
  /** Подсказка derived-состояния хоста (панель скрыта шириной) — текст
   *  рендерится чипом в правом слоте последней полосы, НЕ поверх контента. */
  hintText?: string;
  /** Скрыть вкладку из личного набора (последнюю видимую нельзя). */
  onHideTab?: (tabId: string) => void;
  /** Закрыть closable-вкладку (файл) — отдельный хост-обработчик. */
  onCloseTab?: (tabId: string) => void;
  /** Можно ли скрыть конкретную вкладку (файловые/системные — по правилам хоста). */
  canHideTab?: (tabId: string) => boolean;
  /** Минимум области для перегородки (чат 420/280, прочие 280). */
  groupMin?: (group: CardTabGroup) => number;
  className?: string;
}

/**
 * Области вкладок карточки (#746): 1–2 полосы, содержимое, DnD с линией
 * вставки, сплит/merge, контекстное меню и клавиатура. Общий движок для
 * проекта/задачи/письма: карточка даёт реестр вкладок и контент, движок —
 * модель, геометрию и доступность.
 *
 * Содержимое всех посещённых вкладок живёт в ОДНОМ слое (стабильные key):
 * при переносе между областями меняется только позиция/видимость панели,
 * React не ремаунтит её — скролл чата и зум PDF сохраняются.
 */
export function CardTabAreas({
  tabs,
  state,
  onStateChange,
  onSplitTab,
  renderPanel,
  label,
  groupW = [],
  collapsedGroupId = null,
  onGroupWidthsChange,
  actions,
  trailing,
  hintText,
  onHideTab,
  onCloseTab,
  canHideTab,
  groupMin,
  className,
}: CardTabAreasProps) {
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const groupEls = useRef(new Map<string, HTMLDivElement>());
  const stripEls = useRef(new Map<string, HTMLDivElement>());
  const [width, setWidth] = useState(0);
  const [menu, setMenu] = useState<CardTabMenuState | null>(null);
  const [announcement, setAnnouncement] = useState({ text: '', seq: 0 });
  const [dragWidths, setDragWidths] = useState<number[] | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    // Layout-ширина, не rect: при FLIP-раскрытии карточки transform масштабирует
    // rect, а ResizeObserver на transform не срабатывает — полоса оставалась
    // уже карточки и справа чернел зазор до перезагрузки (фидбек 11.11).
    const measure = (layoutWidth?: number) => setWidth(layoutWidth ?? el.offsetWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize?.[0];
      measure(box?.inlineSize);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const collapsed = Boolean(collapsedGroupId) && state.groups.length > 1;
  // Свёрнутая область — самый сильный derived-сигнал: он важнее подсказки
  // панели хоста (обе живут в правом слоте полосы, не поверх контента).
  const stripHint = collapsed ? (
    <span data-collapsed-hint className="flex">
      <CardWidthHint text={ui.cardTabs.areaCollapsed} />
    </span>
  ) : hintText ? (
    <CardWidthHint text={hintText} />
  ) : null;
  const renderState = useMemo<CardTabsState>(() => {
    if (!collapsed) return state;
    const merged = mergeGroups(state.groups, state.focusGroupId);
    return { ...state, groups: merged, focusGroupId: merged[0]?.id ?? null };
  }, [collapsed, state]);
  const groups = renderState.groups;
  useEffect(() => {
    if (dragWidths && dragWidths.length !== groups.length) setDragWidths(null);
  }, [dragWidths, groups.length]);
  const tabById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);

  // Ширины: solver → по state.groups; свёрнутая — 0. Перерисовка перегородки
  // во время drag идёт локальным состоянием (в prefs — на pointerup).
  const widths = useMemo(() => {
    if (dragWidths) return dragWidths;
    if (collapsed) return [width || 1];
    const raw = groups.map((group) => {
      const index = state.groups.findIndex((entry) => entry.id === group.id);
      return index >= 0 ? (groupW[index] ?? 0) : 0;
    });
    const sum = raw.reduce((acc, value) => acc + value, 0);
    if (!width) return raw.map(() => 0);
    if (sum <= 0) return raw.map(() => Math.floor(width / Math.max(1, raw.length)));
    // Solver уже отдаёт экранные px рабочей зоны: НЕ масштабируем по
    // собственному ResizeObserver — при открытии панели его ширина
    // обновляется на кадр позже, и пропорциональный пересчёт давал двойной
    // ресайз («вкладки сжались и вернулись»). Добираем только недостачу.
    const applied = raw.map((value) => Math.round(value));
    const last = applied.length - 1;
    if (sum < width && applied[last] !== undefined) applied[last] += width - sum;
    return applied;
  }, [collapsed, dragWidths, groupW, groups, state.groups, width]);

  const geometry = useCardTabGeometry({ rootRef, groups, stripEls });

  const announce = useCallback((text: string) => {
    setAnnouncement((prev) => ({ text, seq: prev.seq + 1 }));
  }, []);

  const focusTab = useCallback((tabId: string) => {
    requestAnimationFrame(() => {
      const escaped = typeof CSS !== 'undefined' ? CSS.escape(tabId) : tabId;
      const holder = rootRef.current?.querySelector<HTMLElement>(`[data-card-tab-id="${escaped}"]`);
      // data-атрибут стоит на обёртке вкладки (кнопка с ролью tab — внутри):
      // фокусируем саму кнопку, иначе фокус не возвращается.
      (holder?.querySelector<HTMLElement>('[role="tab"]') ?? holder)?.focus();
    });
  }, []);

  const apply = useCallback(
    (next: CardTabsState) => {
      // Появление второй области — всегда через 50/50 (и кнопка шапки, и
      // меню/DnD): иначе остаток solver'а отдал бы новой области 2/3.
      if (onSplitTab && state.groups.length === 1 && next.groups.length === 2) {
        onSplitTab(next, width);
        return;
      }
      onStateChange(next);
    },
    [onSplitTab, onStateChange, state.groups.length, width],
  );

  const applyResolution = useCardTabApply({
    state,
    tabById,
    onApply: apply,
    onAnnounce: announce,
    onFocusTab: focusTab,
  });

  const drag = useCardTabDrag({
    state: renderState,
    labelOf: (tabId) => tabById.get(tabId)?.label ?? tabId,
    geometry,
    onResolve: applyResolution,
  });

  const openContextMenu = (groupId: string, tabId: string, x: number, y: number) => {
    setMenu({ groupId, tabId, label: tabById.get(tabId)?.label ?? tabId, x, y });
  };
  const onStripKeyDown = useCardTabKeyboard({
    state,
    onApply: apply,
    onFocusTab: focusTab,
    onOpenMenu: openContextMenu,
  });

  return (
    <div ref={rootRef} className={cn('relative flex h-full min-h-0 flex-col', className)}>
      <CardTabStripRow
        groups={groups}
        tabById={tabById}
        widths={widths}
        width={width}
        label={label}
        baseId={baseId}
        draggingTabId={drag.visual?.tabId ?? null}
        actions={actions ?? (() => null)}
        trailing={trailing ?? (() => null)}
        hint={stripHint}
        onCloseTab={onCloseTab}
        onActivate={(groupId, tabId) => {
          if (!drag.suppressClick()) apply(activateTab(state, groupId, tabId));
        }}
        onTabPointerDown={(groupId, tabId, event) =>
          drag.start(groupId, tabId, event, event.currentTarget)
        }
        onTabContextMenu={(groupId, tabId, event) => {
          event.preventDefault();
          openContextMenu(groupId, tabId, event.clientX, event.clientY);
        }}
        onKeyDown={onStripKeyDown}
        registerGroup={(groupId, el) => {
          if (el) groupEls.current.set(groupId, el);
          else groupEls.current.delete(groupId);
        }}
        registerStrip={(groupId, el) => {
          if (el) stripEls.current.set(groupId, el);
          else stripEls.current.delete(groupId);
        }}
      />

      <CardTabPanelLayer
        state={state}
        groups={groups}
        tabs={tabs}
        widths={widths}
        width={width}
        baseId={baseId}
        renderPanel={renderPanel}
      />

      {groups.length === 2 && width > 0 ? (
        <CardTabSplitter
          leftW={widths[0] ?? 0}
          totalW={width}
          minLeft={groupMin?.(groups[0]!) ?? CARD_TAB_WIDTH.groupMin}
          minRight={groupMin?.(groups[1]!) ?? CARD_TAB_WIDTH.groupMin}
          onChange={(left) => setDragWidths([left, width - left])}
          onCommit={(left) => {
            setDragWidths(null);
            onGroupWidthsChange?.([Math.round(left), Math.round(width - left)]);
          }}
          onReset={() => {
            setDragWidths(null);
            onGroupWidthsChange?.([Math.round(width / 2), width - Math.round(width / 2)]);
          }}
        />
      ) : null}

      <CardTabDndLayer marker={drag.marker} visual={drag.visual} />

      <CardTabContextMenu
        menu={menu}
        state={state}
        tabById={tabById}
        onClose={() => {
          const tab = menu?.tabId;
          setMenu(null);
          if (tab) focusTab(tab);
        }}
        onApply={apply}
        onAnnounce={announce}
        onFocusTab={focusTab}
        onCloseTab={onCloseTab}
        onHideTab={onHideTab}
        canHideTab={canHideTab}
      />

      <span key={announcement.seq} aria-live="polite" className="sr-only">
        {announcement.text}
      </span>
    </div>
  );
}
