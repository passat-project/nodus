import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { CARD_TAB_WIDTH } from './card-tabs-width.js';
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
  renderPanel,
  label,
  groupW = [],
  collapsedGroupId = null,
  onGroupWidthsChange,
  actions,
  trailing,
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
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const collapsed = Boolean(collapsedGroupId) && state.groups.length > 1;
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
    const scaled = raw.map((value) => Math.round((value / sum) * width));
    const last = scaled.length - 1;
    if (last >= 0) {
      scaled[last] = (scaled[last] ?? 0) + width - scaled.reduce((acc, value) => acc + value, 0);
    }
    return scaled;
  }, [collapsed, dragWidths, groupW, groups, state.groups, width]);

  const geometry = useCardTabGeometry({ rootRef, groups, stripEls });

  const announce = useCallback((text: string) => {
    setAnnouncement((prev) => ({ text, seq: prev.seq + 1 }));
  }, []);

  const focusTab = useCallback((tabId: string) => {
    requestAnimationFrame(() => {
      const escaped = typeof CSS !== 'undefined' ? CSS.escape(tabId) : tabId;
      rootRef.current?.querySelector<HTMLElement>(`[data-card-tab-id="${escaped}"]`)?.focus();
    });
  }, []);

  const apply = useCallback(
    (next: CardTabsState) => {
      onStateChange(next);
    },
    [onStateChange],
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

      {collapsed ? (
        <span
          data-collapsed-hint
          className="pointer-events-none absolute top-11 right-2 z-10 rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          {ui.cardTabs.areaCollapsed}
        </span>
      ) : null}

      {drag.marker ? (
        <div
          aria-hidden
          data-insert-marker
          className={cn(
            'pointer-events-none fixed z-[80] bg-port',
            drag.marker.kind === 'area' ? 'w-0.5' : 'w-px',
          )}
          style={{ left: drag.marker.x, top: drag.marker.y, height: drag.marker.height }}
        />
      ) : null}

      {drag.visual ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[80] flex h-8 max-w-52 -translate-y-1/2 translate-x-2 items-center rounded-md border border-border bg-popover px-2 text-body-xs text-foreground shadow-md"
          style={{ left: drag.visual.x, top: drag.visual.y }}
        >
          <span className="truncate">{drag.visual.label}</span>
        </div>
      ) : null}

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
