import { memo } from 'react';
import { Handle, useConnection, type NodeProps } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import type { StageColor, StageOutcome, TaskSystemState } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { Check, CircleAlert, X, Zap } from 'lucide-react';

import { stageTone } from '../ui/board/stage-tone.js';
import { FLOW_HANDLE_IDS, SIDE_POSITION, handleRatio, handleSide } from './flow-handles.js';

/** Данные узла статуса на холсте маршрута (#378). */
export interface StatusNodeData extends Record<string, unknown> {
  name: string;
  color: StageColor;
  systemState: TaskSystemState;
  isInitial: boolean;
  outcome: StageOutcome | null;
  /** Есть проблема схемы на этом статусе (бейдж). */
  hasProblem: boolean;
  /** Текущий статус задачи («Схема маршрута») — свечение. */
  current?: boolean;
  readOnly: boolean;
  /** Сколько задач стоит в статусе (редактор; 0 — не показывается). */
  taskCount?: number;
  /** Действия статуса (#633) — кнопки без смены статуса: бейдж и подсказка. */
  actions?: readonly { id: string; name: string }[];
  /** Какое из действий выделено в редакторе — бейдж подсвечен. */
  selectedActionId?: string | null;
  /** Занятые точки подключения (к ним приходят стрелки) — кружки всегда. */
  ports?: readonly string[];
  /** Точки на концах выделенной стрелки — подсвечены. */
  selectedPorts?: readonly string[];
}

export type StatusFlowNode = Node<StatusNodeData, 'status'>;

const stateLabel: Record<TaskSystemState, string> = {
  backlog: ui.automation.bands.backlog,
  active: ui.automation.bands.active,
  paused: ui.automation.bands.paused,
  done: ui.automation.bands.done,
  closed: ui.automation.bands.closed,
};

/**
 * Узел статуса маршрута: карточка 208×52 с цветной полосой слева (цвет
 * статуса), названием и подписью этапа; справа — «Начальный», итог (✓/✕),
 * проблема, счётчик задач. 12 точек подключения (по три на сторону, как в
 * Трекере) — кружки на границе: занятые (к ним приходят стрелки) видны
 * всегда и залиты тоном линии — стрелка упирается в кружок без зазора;
 * свободные в правке — приглушённые, ярче на наведении, у выделенного и при
 * протягивании связи; в просмотре свободных нет. Выбранный — кольцо,
 * текущий статус задачи — свечение (только у активного узла).
 */
export const StatusNode = memo(function StatusNode({
  id,
  data,
  selected,
}: NodeProps<StatusFlowNode>) {
  const tone = stageTone[data.color];
  const active = selected || data.current;
  const connecting = useConnection((connection) => connection.inProgress);
  const showHandles = !data.readOnly && (selected || connecting);
  return (
    <div className="group relative" data-status-id={id}>
      <div
        role="button"
        style={active ? { filter: 'drop-shadow(0 0 6px var(--glow))' } : undefined}
        aria-label={`${ui.automation.stageAria} «${data.name}», ${ui.automation.bandAria} «${stateLabel[data.systemState]}»`}
        className={cn(
          'flow-node-card flex h-[52px] w-[208px] items-stretch overflow-hidden rounded-[10px] border bg-card transition-colors',
          active ? 'border-ring ring-1 ring-ring/30' : 'border-border',
        )}
      >
        <span aria-hidden className={cn('w-1 shrink-0', tone.dot)} />
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2">
          <span
            className="truncate pt-[1px] text-[13px] leading-none font-medium"
            title={data.name}
          >
            {data.name}
          </span>
          <span className="truncate text-[10px] leading-none font-medium tracking-[0.08em] text-muted-foreground uppercase">
            {stateLabel[data.systemState]}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end justify-center gap-1 pr-2.5">
          {data.isInitial ? (
            <span className="text-[9px] leading-none font-semibold tracking-[0.1em] text-muted-foreground uppercase">
              {ui.automation.initialMark}
            </span>
          ) : null}
          <span className="flex items-center gap-1 text-muted-foreground">
            {data.actions && data.actions.length > 0 ? (
              <span
                title={`${ui.automation.panel.sectionActions}: ${data.actions
                  .map((action) => action.name)
                  .join(', ')}`}
                className={cn(
                  'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] leading-none font-semibold tabular-nums',
                  data.selectedActionId
                    ? 'bg-primary/15 text-primary'
                    : 'bg-accent text-muted-foreground',
                )}
              >
                <Zap className="size-3" strokeWidth={1.75} aria-hidden />
                {data.actions.length}
              </span>
            ) : null}
            {data.taskCount ? (
              <span
                className="font-mono text-[11px] leading-none tabular-nums"
                title={`${ui.automation.stageTasksCount}: ${data.taskCount}`}
              >
                {data.taskCount}
              </span>
            ) : null}
            {data.outcome === 'success' ? (
              <Check className="size-3.5 text-success" aria-label={ui.automation.outcomeSuccess} />
            ) : data.outcome === 'cancelled' ? (
              <X className="size-3.5 text-danger" aria-label={ui.automation.outcomeCancelled} />
            ) : data.outcome === 'rejected' ? (
              <X className="size-3.5 text-danger" aria-label={ui.automation.outcomeRejected} />
            ) : null}
            {data.hasProblem ? <CircleAlert className="size-3.5 text-danger" aria-hidden /> : null}
          </span>
        </span>
      </div>
      {FLOW_HANDLE_IDS.map((handle) => {
        const side = handleSide(handle);
        const along = `${handleRatio(handle) * 100}%`;
        const used = data.ports?.includes(handle) ?? false;
        return (
          <Handle
            key={handle}
            id={handle}
            type="source"
            position={SIDE_POSITION[side]}
            isConnectable={!data.readOnly}
            style={side === 't' || side === 'b' ? { left: along } : { top: along }}
            className={cn(
              'flow-port',
              used && 'flow-port-used',
              data.selectedPorts?.includes(handle) && 'flow-port-selected',
              data.readOnly
                ? cn('pointer-events-none', !used && 'opacity-0')
                : !used && !showHandles && 'flow-port-idle',
            )}
          />
        );
      })}
    </div>
  );
});
