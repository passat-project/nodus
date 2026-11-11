import { Info } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

/** Подсказка derived-состояния ширины (#746): панель скрыта/область
 *  свёрнута — это НЕ настройка пользователя, вернётся при расширении.
 *  Живёт в правом слоте полосы вкладок (хром), не поверх контента; кегль —
 *  ступень меток 12px, поверхность — ступень `muted` с hairline. */
export function CardWidthHint({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(
        'pointer-events-none inline-flex h-6 max-w-72 shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted px-2 text-label-sm text-muted-foreground',
        className,
      )}
      title={text}
    >
      <Info className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{text}</span>
    </span>
  );
}

export const PANEL_HIDDEN_HINT = ui.cardTabs.panelHidden;
