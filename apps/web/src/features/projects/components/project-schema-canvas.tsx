import type { ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

/** Точечная сетка канвы — тот же тон и шаг, что у холста схем (flow-theme). */
const DOTS = {
  backgroundImage:
    'radial-gradient(circle, color-mix(in oklab, var(--edge) 55%, transparent) 1px, transparent 1px)',
  backgroundSize: '28px 28px',
} as const;

/**
 * Вкладка «Схема» типа проекта (#556, каркас #38; композиция карточки —
 * вердикт владельца 26.11.2026): холст на всю площадь вкладки — точечная
 * сетка и постоянный узел «Создание проекта» по центру (как «создание» в
 * маршруте задачи): клик открывает редактор окна создания проекта. Остальная
 * схема (статусы #856, папки-комплекты и ветки #38) появится здесь же —
 * переключение вкладок меняет только содержимое рамы, холст не «центр окна».
 */
export function ProjectSchemaCanvas({
  type,
  canSetup,
  onOpenWindow,
}: {
  type: ProjectType;
  canSetup: boolean;
  /** Узел «Создание проекта»: редактор окна создания проекта этого типа. */
  onOpenWindow: () => void;
}) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden" style={DOTS}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
        <button
          type="button"
          onClick={onOpenWindow}
          title={ui.projects.schemasCreationNodeHint}
          className={cn(
            'flow-node-card flex h-10 max-w-[280px] min-w-0 items-center gap-2 rounded-full border border-dashed border-border bg-card px-3 text-muted-foreground transition-colors',
            canSetup ? 'hover:border-input hover:text-foreground' : 'cursor-default',
            'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30',
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
        <span className="sr-only">{type.name}</span>
      </div>
    </div>
  );
}
