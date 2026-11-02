import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  clearedNodeFields,
  effectiveNodeForm,
  missingNodeFields,
  nodeFormKey,
  requiredNodeFields,
  type CustomFieldValue,
  type CustomFieldValues,
  type NodeFormKey,
  type NodeKind,
  type NodeKindForm,
} from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
  type RegistryFieldChange,
} from '../custom-fields/ports/custom-field-registry.port.js';
import type { ProjectActor } from './ports/project-reader.port.js';

/** Создание: значения формы, пришедшие от клиента (могут быть неполными). */
export interface NodeFormCreateInput {
  code?: string | null;
  customFields?: CustomFieldValues;
}

/** Правка: патч значений — `null` очищает ключ (канон custom-field-values). */
export interface NodeFormPatchInput {
  code?: string | null;
  customFields?: Record<string, CustomFieldValue | null>;
}

export interface NodeFormCurrent {
  code: string | null;
  customFields: CustomFieldValues;
}

/**
 * Политика формы вида папки (#556, Р6) — ОДНА точка для всех путей:
 * создание, пачка, правка, смена вида. Значения проверяет порт
 * `CUSTOM_FIELD_REGISTRY` со скоупингом `fieldIds` формы вида (Р4): чужой
 * атрибут — 422 `not_in_type`, очистка (`null`) разрешена всегда.
 *
 * 1. Создание и пачка: умолчания атрибутов формы, затем обязательные
 *    (слоты `required` + шифр при `form.code='required'`) — 422
 *    `PROJECT_NODE_FIELDS_REQUIRED { reason: 'create' }`.
 * 2. Правка без смены вида: очистка обязательного (`null`/пусто) — 422
 *    `reason: 'clear'`.
 * 3. Правка со сменой вида: умолчания атрибутов НОВОГО вида, которых нет в
 *    текущих значениях, ставятся до проверки; обязательные нового вида
 *    проверяются по `next` и шифру (`body.code !== undefined ? body.code :
 *    node.code` — НЕ `??`: `null` очищает) — 422 `reason: 'kind_change'`.
 *    Значения прежнего вида не трогаются (скрыты, Р5).
 * 4. Шифр «скрыто»: поле не показывается, ввод шифра — 400 (как политика
 *    шифра типов проектов); записанный раньше шифр при смене вида не
 *    стирается (В10).
 *
 * Ретро-проверки пустых обязательных у старых папок нет (как #432):
 * в интерфейсе пустое обязательное подсвечено.
 */
@Injectable()
export class NodeFormPolicy {
  constructor(@Inject(CUSTOM_FIELD_REGISTRY) private readonly registry: CustomFieldRegistry) {}

  /** Создание/пачка: значения с умолчаниями + проверка обязательных. */
  async prepareCreate(
    kind: NodeKind,
    input: NodeFormCreateInput,
    authorId: string,
    actor: ProjectActor,
    tx?: TransactionClient,
  ): Promise<CustomFieldValues> {
    const form = await this.formOf(kind, tx);
    assertCodeVisible(kind, form, input.code);
    const values = await this.registry.prepareCreate(
      'node',
      {
        input: input.customFields ?? {},
        authorId,
        actor,
        fieldIds: fieldIdsOf(form),
      },
      tx,
    );
    const missing = missingNodeFields(form, {
      code: input.code ?? null,
      customFields: values,
    });
    if (missing.length > 0) throw fieldsRequired(kind.id, missing, 'create');
    return values;
  }

  /** Правка: проверка значений, очистки и обязательных (смена вида — по next). */
  async prepareUpdate(
    kind: NodeKind,
    current: NodeFormCurrent,
    patch: NodeFormPatchInput,
    opts: { authorId: string; actor: ProjectActor; kindChanged: boolean },
    tx?: TransactionClient,
  ): Promise<{ values: CustomFieldValues; changes: RegistryFieldChange[] }> {
    const form = await this.formOf(kind, tx);
    assertCodeVisible(kind, form, patch.code);
    const fieldIds = fieldIdsOf(form);
    const patchValues: Record<string, CustomFieldValue | null> = { ...(patch.customFields ?? {}) };

    if (opts.kindChanged) {
      // Умолчания нового вида — только для атрибутов, которых ещё нет ни в
      // текущих значениях, ни в патче (значение клиента важнее умолчания).
      const missingDefaults = fieldIds.filter(
        (fieldId) =>
          current.customFields[fieldId] === undefined && patchValues[fieldId] === undefined,
      );
      if (missingDefaults.length > 0) {
        const defaults = await this.registry.prepareCreate(
          'node',
          { input: {}, authorId: opts.authorId, actor: opts.actor, fieldIds: missingDefaults },
          tx,
        );
        for (const [fieldId, value] of Object.entries(defaults)) {
          if (patchValues[fieldId] === undefined) patchValues[fieldId] = value;
        }
      }
    }

    const { next, changes } = await this.registry.prepareUpdate(
      'node',
      { current: current.customFields, patch: patchValues, actor: opts.actor, fieldIds },
      tx,
    );

    if (opts.kindChanged) {
      const nextCode = patch.code !== undefined ? patch.code : current.code;
      const missing = missingNodeFields(form, { code: nextCode, customFields: next });
      if (missing.length > 0) throw fieldsRequired(kind.id, missing, 'kind_change');
    } else {
      const byFormKey: Record<string, unknown> = {
        ...Object.fromEntries(
          Object.entries(patchValues).map(([fieldId, value]) => [nodeFormKey(fieldId), value]),
        ),
        ...(patch.code !== undefined ? { code: patch.code } : {}),
      };
      const cleared = clearedNodeFields(requiredNodeFields(form), byFormKey);
      if (cleared.length > 0) throw fieldsRequired(kind.id, cleared, 'clear');
    }
    return { values: next, changes };
  }

  /** Эффективная форма: без неизвестных и скрытых в «Атрибутах» определений (C1). */
  private async formOf(kind: NodeKind, tx?: TransactionClient): Promise<NodeKindForm> {
    const definitions = await this.registry.definitions('node', {}, tx);
    return effectiveNodeForm(kind, definitions);
  }
}

function fieldIdsOf(form: NodeKindForm): string[] {
  return form.fields.map((slot) => slot.fieldId);
}

function assertCodeVisible(
  kind: NodeKind,
  form: NodeKindForm,
  code: string | null | undefined,
): void {
  if (form.code !== 'hidden' || code === undefined || code === null) return;
  throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Code is hidden for this kind', {
    kindId: kind.id,
  });
}

function fieldsRequired(
  kindId: string,
  fields: NodeFormKey[],
  reason: 'create' | 'kind_change' | 'clear',
): DomainException {
  return new DomainException(
    ErrorCode.PROJECT_NODE_FIELDS_REQUIRED,
    'Required node fields are missing',
    { kindId, fields, reason },
  );
}
