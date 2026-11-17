import { ErrorCode } from '@nodus/contracts';

import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import { DomainException } from '../../../../core/errors/domain-exception.js';
import type {
  WorkflowActor,
  WorkflowFormApplied,
  WorkflowStageChangeMeta,
} from '../../../../core/ports/workflow-entity.port.js';
import type { NumberSeriesService } from '../../numbering/number-series.service.js';
import type {
  NumberIssue,
  NumberPlan,
  NumberingFailure,
} from '../../../custom-fields/ports/number-issue.port.js';
import type { TransitionDef } from '../transition-rules.js';
import { checkFormInput, windowOf } from '../transition-form.js';
import type { WorkflowEntityRegistry } from './entity-adapter.registry.js';

export const EMPTY_APPLIED: WorkflowFormApplied = {
  fields: {},
  timeEntryId: null,
  result: null,
};

export const hasApplied = (applied: WorkflowFormApplied): boolean =>
  Object.keys(applied.fields).length > 0 || applied.timeEntryId !== null || applied.result !== null;

/** Подпись раздела «Причина / комментарий» окна (для блока в чате). */
export function commentLabelOf(t: TransitionDef): string | undefined {
  const section = t.form?.enabled ? t.form.sections.find((s) => s.kind === 'comment') : undefined;
  return section?.kind === 'comment' ? section.label : undefined;
}

/** Кнопка без обязательного окна не блокирует жест DnD/«Мой план». */
export function requiresWindow(t: TransitionDef): boolean {
  return windowOf(t.form, t.rules).required.length > 0;
}

/** Заменная кнопка DnD (#866, AUD-008): жест окно не открывает, поэтому
 *  исполнение кнопки с обязательным окном без формы — отказ 422, а не
 *  молчаливый переход в её стадию. */
export function assertFallbackWindow(t: TransitionDef): void {
  if (!requiresWindow(t)) return;
  const { sections } = windowOf(t.form, t.rules);
  const { missing } = checkFormInput(sections, {});
  throw new DomainException(
    ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID,
    'Transition window is required',
    { transitionId: t.id, missing, unexpected: [] },
  );
}

/** Пост-функция «Присвоить номер» письма: номер из серии типа сущности.
 *  Пост-функции с `fieldId` (номер в атрибут-счётчик задачи, #630) этот
 *  путь не трогает — их выдаёт адаптер задач (Пакет B3 техплана). */
export async function assignNumber(
  numbers: NumberSeriesService,
  tx: TransactionClient,
  subject: { typeId: string },
  t: TransitionDef,
): Promise<WorkflowStageChangeMeta['numbering']> {
  if (!t.rules.postFunctions.some((pf) => pf.kind === 'assign_number' && !pf.fieldId)) {
    return undefined;
  }
  return numbers.nextForType(tx, subject.typeId);
}

function numberingException(failure: NumberingFailure): DomainException {
  if (failure.kind === 'empty') {
    return new DomainException(ErrorCode.NUMBER_SEGMENT_EMPTY, 'Number has an empty part', {
      fieldId: failure.fieldId,
      fieldName: failure.fieldName,
      segments: failure.segments,
      example: failure.example,
    });
  }
  return new DomainException(
    ErrorCode.NUMBER_CONTAINER_MISSING,
    `Number is not issued («${failure.fieldName}»)`,
    {
      fieldId: failure.fieldId,
      fieldName: failure.fieldName,
      reason: failure.reason,
      index: failure.index,
      name: failure.name,
    },
  );
}

/** План номеров кнопки: только `assign_number {fieldId}`, только поля без
 *  номера (кто первым заполнил — тот выдал). Письмо-серия — отдельный путь
 *  `assignNumber` (без fieldId). */
export async function planTransitionNumbers(
  tx: TransactionClient,
  numberIssue: NumberIssue,
  adapter: ReturnType<WorkflowEntityRegistry['get']>,
  entityId: string,
  picked: TransitionDef,
  opts: { confirmEmptyNumberParts?: boolean },
  actor: WorkflowActor,
): Promise<NumberPlan> {
  const fieldIds = picked.rules.postFunctions
    .filter(
      (pf): pf is { kind: 'assign_number'; fieldId: string } =>
        pf.kind === 'assign_number' && pf.fieldId !== undefined,
    )
    .map((pf) => pf.fieldId);
  if (fieldIds.length === 0 || !adapter.numberTarget) {
    return { ok: true, issue: async () => ({}) };
  }
  const target = await adapter.numberTarget(tx, entityId, actor);
  const empty = fieldIds.filter((fieldId) => {
    const value = target.sources.self[fieldId];
    return value === undefined || value === null || value === '';
  });
  if (empty.length === 0) return { ok: true, issue: async () => ({}) };
  const plan = await numberIssue.plan(tx, empty, target, {
    hostKind: target.host,
    source: 'transition',
    sourceLabel: picked.name,
    confirmEmpty: opts.confirmEmptyNumberParts === true,
  });
  if (!plan.ok) throw numberingException(plan.failure);
  return plan;
}
