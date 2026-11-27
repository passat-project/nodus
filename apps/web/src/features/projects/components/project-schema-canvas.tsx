import type { ProjectType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
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
 * сетка и постоянный узел «Создание проекта» по центру (как «Создание» в
 * маршруте задачи): клик включает вкладку «Форма создания» (единая модель
 * «Процессов», #857); под пояснением — тихое действие туда же для тех, кто не
 * догадывается кликнуть по узлу. Остальная схема (статусы #856, папки-комплекты
 * и ветки #38) появится здесь же — переключение вкладок меняет только
 * содержимое рамы, холст не «центр окна».
 */
export function ProjectSchemaCanvas({
  type,
  canSetup,
  onOpenForm,
}: {
  type: ProjectType;
  canSetup: boolean;
  /** Узел «Создание проекта» и тихое действие под пояснением: включить вкладку
   *  «Форма создания» этого типа. */
  onOpenForm: () => void;
}) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden" style={DOTS}>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
        {/* Узел-старт — один на пустой канве: чуть крупнее узла старта маршрута
            (`h-11` против `h-10`): на 736-пиксельной канве тот же калибр
            читался точкой, и точка входа терялась. */}
        <button
          type="button"
          onClick={onOpenForm}
          title={ui.projects.schemasCreationNodeHint}
          className={cn(
            'flow-node-card flex h-11 max-w-[320px] min-w-0 items-center gap-2 rounded-full border border-dashed border-border bg-card px-4 text-muted-foreground transition-colors',
            canSetup ? 'cursor-pointer hover:border-input hover:text-foreground' : 'cursor-default',
            'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/30',
          )}
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
          <span className="truncate pt-[1px] text-[11px] leading-none font-medium tracking-[0.08em] uppercase">
            {ui.projects.schemasCreationNode}
          </span>
        </button>
        <p className="max-w-md text-center text-xs text-balance text-muted-foreground">
          {ui.projects.schemasCanvasHint}
        </p>
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onOpenForm}>
          {ui.projects.schemasOpenForm}
        </Button>
        <span className="sr-only">{type.name}</span>
      </div>
    </div>
  );
}
