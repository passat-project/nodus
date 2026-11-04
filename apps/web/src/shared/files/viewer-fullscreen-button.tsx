import { Maximize2 } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

/**
 * «Открыть на весь экран» внутри вкладки-просмотрщика (вердикт владельца
 * 04.11.2026): кнопка живёт у зума вложения (панель PDF, нижний правый угол
 * ONLYOFFICE, поверх медиа/текста), а не на общей полосе карточки. Подложка
 * карточки + hairline-бордюр — чтобы читалась на белом документе обеих тем;
 * заливка — тихая (действие вторичное).
 */
export function ViewerFullscreenButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ui.files.fullscreen}
      title={ui.files.fullscreen}
      className={cn(
        'rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      <Maximize2 className="size-4" strokeWidth={1.75} />
    </button>
  );
}
