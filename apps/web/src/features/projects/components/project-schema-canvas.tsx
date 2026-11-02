import type { ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
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
 * колонка холста «Процессов»: верхний бар h-14 с линией (продолжает линию
 * шапки списка и шапки правой панели), ниже — холст с точечной сеткой, где
 * #38 нарисует схему типа (папки-комплекты, работы, связи). Пока холст пуст:
 * единственное действие типа — «Настройки типа» (то же, что в меню строки).
 */
export function ProjectSchemaCanvas({
  type,
  canSetup,
  onOpenSettings,
}: {
  type: ProjectType;
  canSetup: boolean;
  onOpenSettings: () => void;
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
        <div className="absolute inset-0 flex items-center justify-center p-6">
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
    </>
  );
}
