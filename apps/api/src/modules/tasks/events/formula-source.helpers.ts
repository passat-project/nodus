import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FormulaCellRef, FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import type { TaskFormulaService } from '../tasks/task-formula.service.js';

/**
 * Общая часть пересчёта формул задач по событиям-источникам (#632, Р4/Р8).
 * Событие чужого модуля лишь указывает, ЧТО изменилось: ячейки-задачи
 * находятся по зависимостям (`v:project:*`, `v:node:*`, `tree:project:*`,
 * `subtasks:task:*`) и пересчитываются владельцем хоста (I3) — чужие
 * значения не пишутся.
 */

/** Ключи `cf.<uuid>` изменённых атрибутов в событии хоста (канон ADR-0029). */
export function changedFieldIds(fields: readonly string[]): string[] {
  return fields
    .filter((field) => field.startsWith('cf.'))
    .map((field) => field.slice('cf.'.length));
}

/** Номера изменённых атрибутов и глубина ячейки-источника (аккумулятор Р8). */
export async function sourceNumbers(
  cells: FormulaCells,
  hostKind: 'project' | 'node',
  hostId: string,
  fieldIds: readonly string[],
  tx: TransactionClient,
): Promise<{ numbers: number[]; depth: number }> {
  const numbers: number[] = [];
  let depth = 0;
  for (const fieldId of fieldIds) {
    const number = await cells.numberByDefinitionId(fieldId, tx);
    if (number === null) continue;
    numbers.push(number);
    const cellDepth = await cells.depthOf(hostKind, hostId, fieldId, tx);
    if (cellDepth !== null) depth = Math.max(depth, cellDepth);
  }
  return { numbers, depth };
}

/** Хосты-задачи из зависимых ячеек: чужие хосты пишут их модули (I3). */
export function taskHosts(cells: readonly FormulaCellRef[]): string[] {
  return [...new Set(cells.filter((cell) => cell.hostKind === 'task').map((cell) => cell.hostId))];
}

/** Пересчёт всех ячеек найденных задач: только свои хосты (I3). */
export async function recalcTaskHosts(
  formulas: TaskFormulaService,
  tx: TransactionClient,
  actorId: string | null,
  hostIds: readonly string[],
  depth: number,
): Promise<void> {
  for (const hostId of hostIds) {
    await formulas.recalcCells(tx, actorId, hostId, [], depth);
  }
}

/**
 * Пересчёт формул-агрегатов родителя (#632, Р4): состав подзадач изменился —
 * ключ `subtasks:task:<parentId>` есть только у ячеек самого родителя.
 * Глубина — 1 (структурное событие перепривязки).
 */
export async function recalcSubtaskParents(
  formulas: TaskFormulaService,
  cells: FormulaCells,
  tx: TransactionClient,
  actorId: string | null,
  parentIds: readonly (string | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(parentIds.filter((id): id is string => typeof id === 'string'))];
  for (const parentId of ids) {
    const refs = await cells.dependentCellsByDepKey(`subtasks:task:${parentId}`, tx);
    const own = refs.filter((cell) => cell.hostKind === 'task' && cell.hostId === parentId);
    await recalcTaskHosts(formulas, tx, actorId, taskHosts(own), 1);
  }
}
