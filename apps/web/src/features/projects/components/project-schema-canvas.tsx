import type { ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';
import { Settings2 } from 'lucide-react';

import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';

/** Точечная сетка канвы — тот же тон и шаг, что у холста схем (flow-theme). */
const DOTS = {
  backgroundImage:
    'radial-gradient(circle, color-mix(in oklab, var(--edge) 55%, transparent) 1px, transparent 1px)',
  backgroundSize: '28px 28px',
} as const;

/**
 * Центральная панель «Схем проектов» (#556, каркас #38) — окно канваса как
 * колонка холста «Процессов»: верхний бар h-14 с линией, ниже — холст с
 * точечной сеткой. По центру постоянный узел «Создание проекта» (как
 * «создание» в маршруте задачи): клик открывает правую панель «Окно создания
 * проекта» с настройкой формы — тот же сценарий, что у статуса в задачах.
 * Остальная схема (папки-комплекты, работы, связи) появится в #38.
 */
export function ProjectSchemaCanvas({
  type,
  canSetup,
  selected,
  onOpenSettings,
  onOpenWindow,
}: {
  type: ProjectType;
  canSetup: boolean;
  /** Узел выбран — открыта его панель (кольцо выделения, как у статуса). */
  selected: boolean;
  onOpenSettings: () => void;
  /** Узел «Создание проекта»: панель настроек окна создания. */
  onOpenWindow: () => void;
}) {
  return (
    <>
      <header className="nokey @container flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="flex min-w-0 shrink items-center gap-2" title={type.name}>
          <ProcessTypeGlyph icon={type.icon} className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{type.name}</span>
        </span>
        {canSetup ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto shrink-0"
            onClick={onOpenSettings}
            title={ui.projects.schemasTypeSettings}
          >
            <Settings2 className="size-3.5" strokeWidth={1.75} />
            <span className="@max-[720px]:hidden">{ui.projects.schemasTypeSettings}</span>
          </Button>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden" style={DOTS}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
          {/* Старт схемы — та же пунктирная пилюля, что «Создание» в
              «Процессах»: клик открывает правую панель, а не окно поверх
              экрана (вердикт владельца 09.11.2026). */}
          <button
            type="button"
            onClick={onOpenWindow}
            title={ui.projects.schemasCreationNodeHint}
            aria-pressed={selected}
            className={cn(
              'flow-node-card flex h-10 max-w-[280px] min-w-0 items-center gap-2 rounded-full border bg-card px-3 transition-colors',
              selected
                ? 'border-ring text-foreground ring-1 ring-ring/30'
                : 'border-dashed border-border text-muted-foreground hover:border-input hover:text-foreground',
            )}
          >
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
            <span className="truncate pt-[1px] text-[11px] leading-none font-medium tracking-[0.08em] uppercase">
              {ui.projects.schemasCreationNode}
            </span>
          </button>
          <p className="max-w-sm text-center text-xs text-balance text-muted-foreground">
            {ui.projects.schemasCanvasHint}
          </p>
        </div>
      </div>
    </>
  );
}
