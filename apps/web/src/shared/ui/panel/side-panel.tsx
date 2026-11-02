import { useEffect } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';
import { ArrowLeft, X } from 'lucide-react';

import { useFrameReady } from '../use-frame-ready.js';

/** Ширина правой панели окна-сплита (общий канон). */
export const SIDE_PANEL_WIDTH = 384;

/** Открыт ли сейчас оверлей Radix (меню, поповер, список, диалог) — Esc его. */
function overlayOpen(): boolean {
  return document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]') !== null;
}

/**
 * Правая панель окна-сплита — канон панели беседы мессенджера (вердикт
 * владельца 20.10.2026: «как в мессенджере»): ПОЛНОВЫСОТНАЯ колонка-сиблинг
 * рабочей области, занимает и верхний бар — её шапка h-14 (название слева,
 * крестик у края справа) продолжает линию border-b бара окна; border-l
 * отделяет от холста. Выезжает справа налево шириной и СУЖАЕТ холст: граф не
 * двигается, край холста его просто обрезает. Обёртка монтирована всегда
 * (w-0), класс раскрытия — после двух кадров (`useFrameReady`): первое
 * открытие после перезагрузки тоже плавное (закон выдвижных поверхностей).
 * Прокрутка только вертикальная. Esc: сначала «назад» из раздела, потом
 * закрыть.
 */
export function SidePanel({
  open,
  title,
  onClose,
  onBack,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Раздел внутри панели: стрелка «назад» в шапке (и первый Esc). */
  onBack?: () => void;
  children: React.ReactNode;
}) {
  const ready = useFrameReady();

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || overlayOpen()) return;
      event.preventDefault();
      if (onBack) onBack();
      else onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onBack, onClose]);

  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={cn(
        'h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
        open && ready ? 'w-[384px]' : 'w-0',
      )}
    >
      {/* nokey: Delete/Backspace на контролах панели (Select, Switch) не
          удаляют выделенное на холсте (фильтр клавиш React Flow). */}
      <aside className="nokey flex h-full w-[384px] flex-col border-l border-border bg-card">
        <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-3">
          {onBack ? (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 hover:bg-accent"
              onClick={onBack}
              aria-label={ui.common.back}
              title={ui.common.back}
            >
              <ArrowLeft />
            </Button>
          ) : null}
          <NodeLabel label={title} className="min-w-0 truncate pl-1" />
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto shrink-0 hover:bg-accent"
            onClick={onClose}
            aria-label={ui.common.close}
          >
            <X />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto p-4 *:min-w-0">
          {children}
        </div>
      </aside>
    </div>
  );
}
