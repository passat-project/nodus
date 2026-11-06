import { ErrorCode, isOpenState } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import type { CatalogStage } from '../../workflows/ports/process-catalog-reader.port.js';

/** Колонка «Моего плана» (строка workflowStage личного маршрута). */
export type PersonalColumn = { id: string; systemState: string; outcome: string | null };

/** Запрошенная цель перехода создания: конкретная стадия или пара
 *  systemState/outcome (колонка «Моего плана»). */
export type CreateStageRequest =
  { stageId: string } | { systemState: string; outcome: string | null };

/**
 * Выбор стадии рождения задачи (#402, security-гейт #37): начальная —
 * первая открытая (backlog/active/paused), цель (колонка/стадия) не
 * обходит условия кнопки — переход выполняется после создания, нет
 * перехода — отказ с причинами. Вынесено из TasksService.create ради
 * лимита строк файла (I5); логика прежняя.
 */
export function resolveCreateStage(
  workflowStages: readonly CatalogStage[],
  personalColumn: PersonalColumn | null,
  stageId: string | undefined,
): { initial: CatalogStage; requested: CreateStageRequest | null; targetIsInitial: boolean } {
  const openStages = workflowStages.filter((s) => isOpenState(s.systemState));
  const initial = openStages.find((s) => s.isInitial) ?? openStages[0];
  if (!initial) throw DomainException.conflict('Workflow has no open stage');
  const personalTarget = personalColumn
    ? (workflowStages.find(
        (s) =>
          s.systemState === personalColumn.systemState &&
          (s.outcome ?? null) === (personalColumn.outcome ?? null),
      ) ?? null)
    : null;
  if (personalColumn && !personalTarget) {
    throw new DomainException(
      ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED,
      'No stage for personal column',
      { fromStageName: initial.name },
    );
  }
  const stageById = stageId ? (workflowStages.find((s) => s.id === stageId) ?? null) : null;
  if (stageId && !stageById) throw DomainException.notFound('Stage not found');
  const requested: CreateStageRequest | null = stageById
    ? { stageId: stageById.id }
    : personalTarget
      ? { systemState: personalTarget.systemState, outcome: personalTarget.outcome ?? null }
      : null;
  const targetIsInitial =
    requested === null ||
    ('stageId' in requested
      ? requested.stageId === initial.id
      : requested.systemState === initial.systemState &&
        (requested.outcome ?? null) === (initial.outcome ?? null));
  return { initial, requested, targetIsInitial };
}
