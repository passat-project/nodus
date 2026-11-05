import { customFieldIdOfKey, type DeciderSource } from '@nodus/contracts';

/** Минимум задачи для расчёта решающих (#433). */
export interface DeciderTaskRow {
  id: string;
  workflowId: string;
  stageId: string;
  systemState: string;
  creatorId: string;
  assigneeId: string;
  projectId: string | null;
  confidential: boolean;
  customFields: Record<string, unknown>;
}

/** Контекст актора для одной задачи: факты + вакантные переходы. */
export interface DeciderTaskContext {
  facts: import('@nodus/contracts').WorkflowDeciderFacts;
  vacantTransitionIds: ReadonlySet<string>;
}

/** Значения user-полей задачи: id определения → id сотрудников. */
export function fieldUserIdsOf(
  task: DeciderTaskRow,
  sources: readonly DeciderSource[],
  userFieldIds: ReadonlySet<string>,
): Record<string, readonly string[]> {
  const result: Record<string, readonly string[]> = {};
  for (const source of sources) {
    if (source.kind !== 'field') continue;
    const fieldId = customFieldIdOfKey(source.field);
    if (fieldId && userFieldIds.has(fieldId)) {
      result[fieldId] = userIdsOf(task.customFields[fieldId]);
    }
  }
  return result;
}

/** Значение user-поля → массив id (скаляр `user` читается как один id). */
export function userIdsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}
