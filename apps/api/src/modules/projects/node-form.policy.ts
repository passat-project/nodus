import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  clearedNodeFields,
  effectiveNodeForm,
  missingNodeFields,
  nodeFormKey,
  requiredNodeFields,
  SYSTEM_FIELD_IDS,
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

/** Создание: значения формы, пришедшие от клиента (могут быть неполными);
 *  `code` — legacy-поле (десктоп), переводится в атрибут «Код». */
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
  customFields: CustomFieldValues;
}

/**
 * Политика формы вида папки (#556, Р6; ревизия #631 — код стал атрибутом):
 * ОДНА точка для всех путей: создание, пачка, правка, смена вида. Значения
 * проверяет порт `CUSTOM_FIELD_REGISTRY` со скоупингом target=node_kind
 * (привязка и слот — одна сущность, Р3): чужой атрибут — 422 `not_in_type`,
 * очистка (`null`) разрешена всегда.
 *
 * 1. Создание и пачка: умолчания атрибутов, затем обязательные слоты —
 *    422 `PROJECT_NODE_FIELDS_REQUIRED { reason: 'create' }`.
 * 2. Правка без смены вида: очистка обязательного (`null`/пусто) — 422
 *    `reason: 'clear'`.
 * 3. Правка со сменой вида: умолчания атрибутов НОВОГО вида, которых нет в
 *    текущих значениях, ставятся до проверки; обязательные нового вида
 *    проверяются по `next` — 422 `reason: 'kind_change'`. Значения прежнего
 *    вида не трогаются (скрыты, Р5).
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
    const values = await this.registry.prepareCreate(
      {
        input: withLegacyCode(input, form),
        authorId,
        actor,
        target: { kind: 'node_kind', id: kind.id },
      },
      tx,
    );
    const missing = missingNodeFields(form, { customFields: values });
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
    const fieldIds = form.fields.map((slot) => slot.fieldId);
    const patchValues: Record<string, CustomFieldValue | null> = { ...(patch.customFields ?? {}) };
    // Legacy-код → атрибут «Код» (десктоп); явное customFields важнее.
    if (
      patch.code !== undefined &&
      patchValues[SYSTEM_FIELD_IDS.nodeCode] === undefined &&
      fieldIds.includes(SYSTEM_FIELD_IDS.nodeCode)
    ) {
      patchValues[SYSTEM_FIELD_IDS.nodeCode] = patch.code;
    }

    if (opts.kindChanged) {
      // Умолчания нового вида — только для атрибутов, которых ещё нет ни в
      // текущих значениях, ни в патче (значение клиента важнее умолчания).
      const missingDefaults = fieldIds.filter(
        (fieldId) =>
          current.customFields[fieldId] === undefined && patchValues[fieldId] === undefined,
      );
      if (missingDefaults.length > 0) {
        const defaults = await this.registry.prepareCreate(
          {
            input: {},
            authorId: opts.authorId,
            actor: opts.actor,
            target: { kind: 'node_kind', id: kind.id },
          },
          tx,
        );
        // prepareCreate без скоупа списка id вернул бы умолчания всех
        // привязанных атрибутов — оставляем только недостающие.
        for (const fieldId of missingDefaults) {
          const value = defaults[fieldId];
          if (value !== undefined && patchValues[fieldId] === undefined) {
            patchValues[fieldId] = value;
          }
        }
      }
    }

    const { next, changes } = await this.registry.prepareUpdate(
      {
        current: current.customFields,
        patch: patchValues,
        actor: opts.actor,
        target: { kind: 'node_kind', id: kind.id },
      },
      tx,
    );

    if (opts.kindChanged) {
      const missing = missingNodeFields(form, { customFields: next });
      if (missing.length > 0) throw fieldsRequired(kind.id, missing, 'kind_change');
    } else {
      const cleared = clearedNodeFields(requiredNodeFields(form), {
        ...Object.fromEntries(
          Object.entries(patchValues).map(([fieldId, value]) => [nodeFormKey(fieldId), value]),
        ),
      });
      if (cleared.length > 0) throw fieldsRequired(kind.id, cleared, 'clear');
    }
    return { values: next, changes };
  }

  /** Эффективная форма: слоты без неизвестных определений (удалённые). */
  private async formOf(kind: NodeKind, tx?: TransactionClient): Promise<NodeKindForm> {
    const definitions = await this.registry.definitions({}, tx);
    return effectiveNodeForm(kind, definitions);
  }
}

/** Legacy `code` → значение атрибута «Код», если он в форме вида. */
function withLegacyCode(input: NodeFormCreateInput, form: NodeKindForm): CustomFieldValues {
  const values: CustomFieldValues = { ...(input.customFields ?? {}) };
  if (
    input.code != null &&
    values[SYSTEM_FIELD_IDS.nodeCode] === undefined &&
    form.fields.some((slot) => slot.fieldId === SYSTEM_FIELD_IDS.nodeCode)
  ) {
    values[SYSTEM_FIELD_IDS.nodeCode] = input.code;
  }
  return values;
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
