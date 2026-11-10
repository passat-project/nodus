import { Info } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

/** Подсказка derived-состояния ширины (#746): панель скрыта/область
 *  свёрнута — это НЕ настройка пользователя, вернётся при расширении. */
export function CardWidthHint({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(
        'pointer-events-none inline-flex items-center gap-1 rounded-md bg-muted/80 px-1.5 py-0.5 text-[10px] text-muted-foreground',
        className,
      )}
      title={text}
    >
      <Info className="size-3" strokeWidth={1.75} />
      {text}
    </span>
  );
}

export const PANEL_HIDDEN_HINT = ui.cardTabs.panelHidden;
