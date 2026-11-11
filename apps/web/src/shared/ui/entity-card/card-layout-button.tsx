import { Columns2, Combine } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Кнопка раскладки вкладок в шапке карточки (#746): одна область —
 * «Разделить» (Columns2), две — «Соединить» (Combine). Quiet icon-only
 * `size="icon-sm"` — ОДНОГО калибра с соседями шапки (правка/меню), фокус
 * и ховер — от примитива Button. НЕ занимает правый слот полосы вкладок —
 * там живёт тоггл панели беседы (PanelRight), это решённая коллизия иконок.
 */
export function CardLayoutButton({
  groupCount,
  onSplit,
  onMerge,
  className,
}: {
  groupCount: number;
  onSplit: () => void;
  onMerge: () => void;
  className?: string;
}) {
  const split = groupCount < 2;
  const label = split ? ui.cardTabs.split : ui.cardTabs.merge;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={split ? onSplit : onMerge}
      aria-label={label}
      title={label}
      className={cn('text-muted-foreground', className)}
    >
      {split ? (
        <Columns2 className="size-4" strokeWidth={1.75} />
      ) : (
        <Combine className="size-4" strokeWidth={1.75} />
      )}
    </Button>
  );
}
