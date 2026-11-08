import type { ProjectType } from '@nodus/contracts';
import { isFormDecor, projectTypeFormOf, ui, withProjectSystemElements } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Settings2, Workflow } from 'lucide-react';

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
 * точечной сеткой. На холсте постоянный узел «Создание проекта» (как
 * «создание» в маршруте задачи): клик открывает окно создания проекта этого
 * типа. Остальная схема (папки-комплекты, работы, связи) появится в #38.
 */
export function ProjectSchemaCanvas({
  type,
  canSetup,
  onOpenSettings,
  onOpenWindow,
}: {
  type: ProjectType;
  canSetup: boolean;
  onOpenSettings: () => void;
  /** Узел «Создание проекта»: редактор окна создания. */
  onOpenWindow: () => void;
}) {
  const fields = withProjectSystemElements(projectTypeFormOf(type)).fields.filter(
    (element) => !isFormDecor(element),
  ).length;

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
        <div className="absolute inset-0 flex flex-col gap-6 p-6">
          {/* Старт схемы — та же пунктирная пилюля, что «Создание» в
              «Процессах»: окно создания проекта открывается с неё, а не из
              панели настроек типа (вердикт владельца 08.11.2026). */}
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onOpenWindow}
              title={ui.projects.schemasCreationNodeHint}
              className="flow-node-card flex h-10 max-w-[260px] min-w-0 items-center gap-2 rounded-full border border-dashed border-border bg-card px-3 text-muted-foreground transition-colors hover:border-input hover:text-foreground"
            >
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
              <span className="truncate pt-[1px] text-[11px] leading-none font-medium tracking-[0.08em] uppercase">
                {ui.projects.schemasCreationNode}
              </span>
            </button>
            <span className="shrink-0 text-xs text-muted-foreground">
              {ui.forms.builder.summary(fields, 0)}
            </span>
          </div>

          <div className="flex flex-1 items-center justify-center">
            <div className="flex max-w-sm flex-col items-center gap-2 text-center">
              <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Workflow className="size-5" strokeWidth={1.5} />
              </span>
              <span className="text-sm font-medium">{ui.projects.schemasCanvasTitle}</span>
              <span className="text-xs text-balance text-muted-foreground">
                {ui.projects.schemasCanvasHint}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
