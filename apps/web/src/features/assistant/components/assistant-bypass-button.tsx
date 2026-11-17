import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ShieldOff } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

const strings = ui.assistant;

/** Порог долгого нажатия (решение владельца 17.11.2026): ≥ 400 мс. */
export const BYPASS_LONG_PRESS_MS = 400;

/**
 * Байпас подтверждений (ADR-0048): ЛИШЬ долгое нажатие переключает режим.
 * Короткий клик — подсказка, а не случайное включение «без вопросов».
 * Активное состояние видно по иконке и подписи в композере; сброс — при
 * смене диалога и закрытии окна (делает хост).
 */
export function AssistantBypassButton({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clear, []);

  function start() {
    fired.current = false;
    clear();
    timer.current = window.setTimeout(() => {
      fired.current = true;
      onToggle();
    }, BYPASS_LONG_PRESS_MS);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={active}
      aria-label={strings.bypassTitle}
      title={active ? strings.bypassActiveHint : strings.bypassHint}
      className={cn(
        'shrink-0',
        active ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'text-muted-foreground',
      )}
      onPointerDown={start}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onClick={() => {
        // Клик после сработавшего долгого нажатия — часть того же жеста.
        if (fired.current) {
          fired.current = false;
          return;
        }
        toast(active ? strings.bypassActiveHint : strings.bypassHint);
      }}
    >
      <ShieldOff className="size-4" strokeWidth={1.75} />
    </Button>
  );
}
