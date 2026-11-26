import type { WorkflowProblem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { ArrowRightLeft, LayoutGrid, Plus } from 'lucide-react';

import { ProblemsChip } from './problems-chip.js';

/**
 * Действия редактора маршрута — ПРАВАЯ часть единого бара вкладок карточки
 * (вердикт владельца 26.11.2026: отдельного верхнего бара над холстом нет,
 * канвас начинается сразу под полосой). «Опубликовать» — главная (primary),
 * «статус / переход / упорядочить» — компактные иконочные кнопки с
 * aria-label, «Сбросить» — только у черновика. Просмотр (письма, нет права)
 * действий не предлагает: остаются только чипы проблем.
 * Панель черновика и состояние публикации живут на холсте (баннеры) и в
 * левой колонке — здесь им не место.
 */
export function RouteToolbarActions({
  canManage,
  dirty,
  problems,
  publishBlocked,
  addTransition,
  onAddStage,
  onTidy,
  onProblemClick,
  onDiscard,
  onPublish,
}: {
  canManage: boolean;
  dirty: boolean;
  problems: readonly WorkflowProblem[];
  publishBlocked: boolean;
  /** Кнопка-поповер «+ Переход»: бар рисует кнопку, хост оборачивает её. */
  addTransition: (trigger: React.ReactNode) => React.ReactNode;
  onAddStage: () => void;
  onTidy: () => void;
  onProblemClick: (problem: WorkflowProblem) => void;
  onDiscard: () => void;
  onPublish: () => void;
}) {
  const errors = problems.filter((p) => p.severity === 'error').length;
  return (
    <div className="flex h-full items-center gap-1">
      {problems.length > 0 ? (
        <div className="flex shrink-0 items-center pr-1">
          <ProblemsChip problems={problems} onProblemClick={onProblemClick} />
        </div>
      ) : null}
      {canManage ? (
        <>
          <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onAddStage}
            title={ui.automation.addStage}
            aria-label={ui.automation.addStage}
          >
            <Plus className="size-4" strokeWidth={1.75} />
          </Button>
          {addTransition(
            <Button
              variant="ghost"
              size="icon-sm"
              title={ui.automation.addTransitionLabel}
              aria-label={ui.automation.addTransitionLabel}
            >
              <ArrowRightLeft className="size-4" strokeWidth={1.75} />
            </Button>,
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onTidy}
            title={ui.automation.tidyUp}
            aria-label={ui.automation.tidyUp}
          >
            <LayoutGrid className="size-4" strokeWidth={1.75} />
          </Button>
          {dirty ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDiscard}
              title={ui.automation.discardShort}
            >
              {ui.automation.discardShort}
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={publishBlocked || errors > 0}
            title={errors > 0 ? `${ui.automation.problemsFixFirst} ${errors}` : undefined}
            onClick={onPublish}
          >
            {ui.automation.publish}
          </Button>
        </>
      ) : null}
    </div>
  );
}
