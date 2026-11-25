import { Globe, Pin, PinOff, Plus, X } from 'lucide-react';
import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@nodus/ui/components/context-menu';
import { cn } from '@nodus/ui/lib/utils';

import { navModuleForPath } from '../../../app/shell/nav-registry.js';
import { usePortalTabsStore, type PortalTab } from '../model/tabs-store.js';

/**
 * Полоса вкладок браузерного типа (#1038 фаза C, ADR-0055): живёт в ЗОНЕ
 * вкладок панели оболочки (shell-panel), поэтому весь компонент виден только
 * в оболочке. Вкладка — иконка модуля (единый реестр навигации) + заголовок
 * (сессионный «Чат·Имя» фичи чата || метка модуля) + ✕ по ховеру; закреплённая
 * — только иконка, ведущая группа слева; переполнение — горизонтальный скролл
 * (вкладки не сжимаются); «+» — новая вкладка. Средний клик закрывает вкладку,
 * ПКМ — закрепить/закрыть, перетаскивание незакреплённых (HTML5 DnD без
 * библиотек) переупорядочивает — сброс отмечается мягкой пунктирной зоной на
 * кромке вставки (канон владельца).
 */

/** pathname из адреса вкладки (url = pathname+search). */
function pathnameOf(url: string): string {
  return url.split('?')[0] ?? url;
}

/** Кламп позиции вставки в незакреплённый диапазон [закрепов .. длина]. */
function clampDropIndex(desired: number, tabs: readonly PortalTab[]): number {
  const from = tabs.filter((t) => t.pinned).length;
  return Math.min(Math.max(desired, from), tabs.length);
}

/** Заголовок вкладки: сессионный кастом || метка модуля || сам путь. */
function tabTitle(tab: PortalTab): string {
  const module = navModuleForPath(pathnameOf(tab.url));
  return tab.title ?? module?.label ?? pathnameOf(tab.url);
}

interface TabButtonProps {
  tab: PortalTab;
  active: boolean;
  index: number;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

function TabButton({
  tab,
  active,
  index,
  dragging,
  dropBefore,
  dropAfter,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: TabButtonProps): ReactNode {
  const module = navModuleForPath(pathnameOf(tab.url));
  const Icon = module?.icon ?? Globe;
  const title = tabTitle(tab);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={active}
          tabIndex={0}
          title={title}
          draggable={!tab.pinned}
          onDragStart={onDragStart}
          onDragOver={(event) => onDragOver(event, index)}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          onClick={() => usePortalTabsStore.getState().switchTab(tab.id)}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              usePortalTabsStore.getState().switchTab(tab.id);
            }
            if (event.key === 'Delete') usePortalTabsStore.getState().closeTab(tab.id);
          }}
          // Средний клик закрывает (preventDefault на mousedown — без автоскролла).
          onMouseDown={(event) => {
            if (event.button === 1) event.preventDefault();
          }}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              usePortalTabsStore.getState().closeTab(tab.id);
            }
          }}
          className={cn(
            // items-stretch родителя: вкладка во всю высоту полосы минус поля.
            'group/tab relative my-1 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active
              ? 'bg-accent text-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            dragging && 'opacity-40',
          )}
        >
          {dropBefore ? <DropZone side="left" /> : null}
          {dropAfter ? <DropZone side="right" /> : null}
          <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
          {!tab.pinned ? (
            <span className="max-w-40 truncate whitespace-nowrap">{title}</span>
          ) : null}
          {!tab.pinned ? (
            <button
              type="button"
              aria-label={ui.common.closeTab}
              title={ui.common.closeTab}
              className={cn(
                'flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground',
                active ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100',
              )}
              onClick={(event) => {
                event.stopPropagation();
                usePortalTabsStore.getState().closeTab(tab.id);
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <X className="size-3" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={() => usePortalTabsStore.getState().togglePin(tab.id)}>
          {tab.pinned ? (
            <PinOff className="size-4" strokeWidth={1.75} />
          ) : (
            <Pin className="size-4" strokeWidth={1.75} />
          )}
          {tab.pinned ? ui.desktop.tabUnpin : ui.desktop.tabPin}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => usePortalTabsStore.getState().closeTab(tab.id)}>
          <X className="size-4" strokeWidth={1.75} />
          {ui.common.closeTab}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Мягкая пунктирная зона сброса на кромке вставки (канон владельца). */
function DropZone({ side }: { side: 'left' | 'right' }): ReactNode {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-y-1 z-10 w-1.5 rounded-sm border border-dashed border-primary/60 bg-primary/10',
        side === 'left' ? '-left-1' : '-right-1',
      )}
    />
  );
}

/**
 * Полоса вкладок. Корень ГАСИТ pointerdown/dblclick: полоса — потомок
 * drag-зоны окна (shell-panel), кнопкой 0 тащит окно — клики по вкладкам
 * и средний клик не должны доходить до перетаскивания рамы.
 */
export function TabsStrip(): ReactNode {
  const tabs = usePortalTabsStore((s) => s.tabs);
  const activeId = usePortalTabsStore((s) => s.activeId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const clearDrag = () => {
    setDragId(null);
    setDropIndex(null);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, index: number): void => {
    if (!dragId || dragId === tabs[index]?.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const state = usePortalTabsStore.getState();
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    const desired = clampDropIndex(index + (after ? 1 : 0), state.tabs);
    // Вставка на собственное место — без индикатора (переупорядочивания нет).
    const from = state.tabs.findIndex((t) => t.id === dragId);
    if (from >= 0 && (from < desired ? desired - 1 : desired) === from) return;
    setDropIndex(desired);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (dragId && dropIndex !== null) {
      const state = usePortalTabsStore.getState();
      const from = state.tabs.findIndex((t) => t.id === dragId);
      const to = from >= 0 && from < dropIndex ? dropIndex - 1 : dropIndex;
      state.moveTab(dragId, to);
    }
    clearDrag();
  };

  return (
    <div
      data-portal-tabs
      role="tablist"
      aria-label={ui.desktop.tabMore}
      className="h-full min-w-0 max-w-full overflow-x-auto overflow-y-hidden"
      data-no-scrollbar
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        clearDrag();
      }}
    >
      <div className="flex h-full w-max items-stretch gap-0.5 pr-1">
        {tabs.map((tab, index) => (
          <TabButton
            key={tab.id}
            tab={tab}
            index={index}
            active={tab.id === activeId}
            dragging={dragId === tab.id}
            dropBefore={dropIndex === index && dragId !== tab.id}
            dropAfter={dropIndex === index + 1 && dragId !== tab.id}
            onDragStart={(event) => {
              setDragId(tab.id);
              event.dataTransfer.setData('text/plain', tab.id);
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={clearDrag}
          />
        ))}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={ui.desktop.tabNew}
          title={ui.desktop.tabNew}
          className="shrink-0 self-center text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => usePortalTabsStore.getState().openTab('/home')}
        >
          <Plus className="size-4" strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}
