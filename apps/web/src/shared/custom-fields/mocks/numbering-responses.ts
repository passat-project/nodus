import { HttpResponse } from 'msw';
import type { CustomFieldDefinition, UpdateCustomFieldBody } from '@nodus/contracts';
import { ErrorCode, errorMessages } from '@nodus/contracts';

import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import type { NumberingFailure } from '../../mocks/data/numbering-create.js';
import { counterPreview, mockIssuedCount, setMockNext } from '../../mocks/data/numbering-store.js';
import { invalidTriggers, unreachableTargets } from './numbering-hosts.js';

const fail = (code: ErrorCode, message: string, status: number, details?: unknown) =>
  HttpResponse.json({ code, message, ...(details ? { details } : {}) }, { status });

/**
 * Правка счётчика (#630, модель v3): после выдач условия «отдельно для» и
 * «заново» заморожены (409); несовместимые привязки и «при создании» не у
 * привязанного типа / письму со счётом по месту — 422 (как сервер, до
 * мутации). Успех — правило и «при создании» записаны, ответа нет (null).
 */
export function counterUpdateResponse(
  definition: CustomFieldDefinition,
  body: UpdateCustomFieldBody,
) {
  const before = definition.numbering?.rule ?? null;
  const nextRule = body.numbering ?? before;
  if (
    body.numbering &&
    before &&
    mockIssuedCount(definition.id) > 0 &&
    (JSON.stringify(body.numbering.containers) !== JSON.stringify(before.containers) ||
      body.numbering.period !== before.period)
  ) {
    return fail(ErrorCode.NUMBER_RULE_LOCKED, 'Counter rule is locked', 409);
  }
  const bindings = body.bindings ?? definition.bindings;
  const targets = nextRule ? unreachableTargets(nextRule, bindings) : [];
  if (targets.length > 0) {
    return fail(ErrorCode.NUMBER_CONTAINER_UNREACHABLE, 'Unreachable container', 422, { targets });
  }
  // Отвязанный тип теряет и «при создании».
  const bound = new Set([
    ...bindings.processTypeIds,
    ...bindings.projectTypeIds,
    ...bindings.nodeKindIds,
  ]);
  const onCreate = (body.numberingOnCreate ?? definition.numbering?.onCreate ?? []).filter(
    (id) => body.numberingOnCreate !== undefined || bound.has(id),
  );
  const triggers = nextRule ? invalidTriggers(nextRule, onCreate, bindings) : [];
  if (triggers.length > 0) {
    return fail(ErrorCode.NUMBER_TRIGGER_INVALID, 'Invalid create trigger', 422, {
      targets: triggers,
    });
  }
  if (nextRule) {
    definition.numbering = {
      rule: nextRule,
      onCreate,
      preview: counterPreview(nextRule),
      issuedCount: mockIssuedCount(definition.id),
    };
  }
  return null;
}

/** Ответы-отказы выдачи номера мок-мира (#630) — общие для создания,
 *  кнопок, смены типа и правки записей; как у сервера. */

/** 409 действия (создание, кнопка, смена типа): нет места для счёта или
 *  пустое поле-вставка без подтверждения — ничего не выдано и не потрачено. */
export function numberingFailureResponse(failure: NumberingFailure) {
  if (failure.kind === 'empty') {
    return HttpResponse.json(
      {
        code: ErrorCode.NUMBER_SEGMENT_EMPTY,
        message: errorMessages[ErrorCode.NUMBER_SEGMENT_EMPTY],
        details: {
          fieldId: failure.fieldId,
          fieldName: failure.fieldName,
          segments: failure.segments,
          example: failure.example,
        },
      },
      { status: 409 },
    );
  }
  return HttpResponse.json(
    {
      code: ErrorCode.NUMBER_CONTAINER_MISSING,
      message: `${errorMessages[ErrorCode.NUMBER_CONTAINER_MISSING]} («${failure.fieldName}»)`,
      details: {
        fieldId: failure.fieldId,
        fieldName: failure.fieldName,
        reason: failure.reason,
        index: failure.index,
        name: failure.name,
      },
    },
    { status: 409 },
  );
}

/** 422 правки: номер счётчика руками не пишется (#630, как сервер) — PATCH
 *  задачи, папки, проекта со значением counter-поля. Окна создания такие
 *  значения молча отбрасывают (`stripCounterValues`). */
export function counterWriteResponse(values: Record<string, unknown>) {
  const counters = demoCustomFieldDefinitions.filter(
    (definition) => definition.type === 'counter' && definition.id in values,
  );
  if (counters.length === 0) return null;
  return HttpResponse.json(
    {
      code: ErrorCode.NUMBER_CELL_IMMUTABLE,
      message: errorMessages[ErrorCode.NUMBER_CELL_IMMUTABLE],
      details: { fieldIds: counters.map((definition) => definition.id) },
    },
    { status: 422 },
  );
}

/** Сид следующего номера сквозного счёта при создании (`numberingNext`). */
export function seedCreatedCounter(definitionId: string, next: number | undefined): void {
  const definition = demoCustomFieldDefinitions.find((entry) => entry.id === definitionId);
  const rule = definition?.numbering?.rule;
  if (rule && next !== undefined && rule.containers.length === 0) {
    setMockNext(definitionId, rule, [], next);
  }
}
