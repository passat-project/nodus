import { ArrowLeft, ArrowRight, Columns2, Combine, EyeOff, MoveHorizontal, X } from 'lucide-react';
import { ui } from '@nodus/contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';

export interface CardTabMenuState {
  groupId: string;
  tabId: string;
  label: string;
  x: number;
  y: number;
}

export interface CardTabMenuActions {
  moveLeft: boolean;
  moveRight: boolean;
  moveToOther: boolean;
  openBeside: boolean;
  mergeAreas: boolean;
  close: boolean;
  hide: boolean;
}

/**
 * Контекстное меню вкладки (#746) — обязательная альтернатива drag
 * (WCAG 2.5.7): перестановка, перенос в другую область, «открыть рядом»,
 * соединение областей, закрытие/скрытие. Открывается правым кликом или
 * Shift+F10; фокус возвращается на вкладку после закрытия.
 */
export function CardTabMenu({
  menu,
  actions,
  onClose,
  onMoveLeft,
  onMoveRight,
  onMoveToOther,
  onOpenBeside,
  onMergeAreas,
  onCloseTab,
  onHideTab,
}: {
  menu: CardTabMenuState | null;
  actions: CardTabMenuActions;
  onClose: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onMoveToOther: () => void;
  onOpenBeside: () => void;
  onMergeAreas: () => void;
  onCloseTab: () => void;
  onHideTab: () => void;
}) {
  return (
    <DropdownMenu open={menu !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          className="fixed size-px opacity-0"
          style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem disabled={!actions.moveLeft} onSelect={onMoveLeft}>
          <ArrowLeft className="size-3.5" strokeWidth={1.75} />
          {ui.cardTabs.moveLeft}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!actions.moveRight} onSelect={onMoveRight}>
          <ArrowRight className="size-3.5" strokeWidth={1.75} />
          {ui.cardTabs.moveRight}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!actions.moveToOther} onSelect={onMoveToOther}>
          <MoveHorizontal className="size-3.5" strokeWidth={1.75} />
          {ui.cardTabs.moveToArea}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!actions.openBeside} onSelect={onOpenBeside}>
          <Columns2 className="size-3.5" strokeWidth={1.75} />
          {ui.cardTabs.openBeside}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!actions.mergeAreas} onSelect={onMergeAreas}>
          <Combine className="size-3.5" strokeWidth={1.75} />
          {ui.cardTabs.mergeAreas}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {actions.hide ? (
          <DropdownMenuItem onSelect={onHideTab}>
            <EyeOff className="size-3.5" strokeWidth={1.75} />
            {ui.cardTabs.hideTab}
          </DropdownMenuItem>
        ) : null}
        {actions.close ? (
          <DropdownMenuItem variant="destructive" onSelect={onCloseTab}>
            <X className="size-3.5" strokeWidth={1.75} />
            {ui.common.closeTab}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
