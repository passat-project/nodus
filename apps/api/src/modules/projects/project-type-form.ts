import {
  ErrorCode,
  type ProjectType,
  type ProjectTypeCreateBody,
  type ProjectTypeForm,
  type ProjectTypeUpdateBody,
} from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import type { EventBus } from '../../core/events/event-bus.js';
import type { CustomFieldRegistry } from '../custom-fields/ports/custom-field-registry.port.js';
import type { NodeKindsRepository } from './project-node-kinds.repository.js';
import { emitProjectTypeChanged } from './project-type-events.js';
import type { ProjectTypesRepository } from './project-types.repository.js';

/** Слоты формы типа — существующие атрибуты записей (Р10 #631): глобальные
 *  переменные привязок не имеют. Ошибка — 422 PROJECT_TYPE_FORM_INVALID. */
export async function assertProjectTypeForm(
  registry: CustomFieldRegistry,
  tx: TransactionClient,
  form: ProjectTypeForm,
): Promise<void> {
  const definitions = await registry.definitions({}, tx);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const issues: { fieldId: string; reason: 'unknown_field' | 'not_bindable' }[] = [];
  for (const slot of form.fields) {
    const definition = byId.get(slot.fieldId);
    if (!definition) issues.push({ fieldId: slot.fieldId, reason: 'unknown_field' });
    else if (definition.isCompany) {
      issues.push({ fieldId: slot.fieldId, reason: 'not_bindable' });
    }
  }
  if (issues.length > 0) {
    throw new DomainException(ErrorCode.PROJECT_TYPE_FORM_INVALID, 'Project type form is invalid', {
      fieldIds: issues,
      reason: issues[0]!.reason,
    });
  }
}

/** Слот И ЕСТЬ привязка (Р3/Р10): запись формы типа синхронизирует
 *  `field_bindings` — добавленный слот привязывает, снятый снимает.
 *  Привязки без слотов (посев системных полей, диалог атрибута) живут:
 *  удаляются только id, реально убранные из формы (#646). */
export function syncProjectTypeForm(
  registry: CustomFieldRegistry,
  tx: TransactionClient,
  id: string,
  form: ProjectTypeForm,
  previousFieldIds: readonly string[] = [],
): Promise<void> {
  const next = form.fields.map((slot) => slot.fieldId);
  const removed = previousFieldIds.filter((fieldId) => !next.includes(fieldId));
  return registry.syncPlaceBindings({ kind: 'project_type', id }, next, removed, tx);
}

/** Создание типа проекта (Р10): имя уникально, форма валидна и становится
 *  привязками, каталожное событие — в той же транзакции. */
export async function createProjectType(
  deps: { types: ProjectTypesRepository; registry: CustomFieldRegistry; eventBus: EventBus },
  tx: TransactionClient,
  dto: ProjectTypeCreateBody,
  actorId: string,
): Promise<ProjectType> {
  await deps.types.lockForms(tx);
  if (await deps.types.nameTaken(dto.name, undefined, tx)) {
    throw DomainException.conflict('Project type name is already taken');
  }
  if (dto.form !== undefined) await assertProjectTypeForm(deps.registry, tx, dto.form);
  const created = await deps.types.create(tx, dto);
  if (dto.form !== undefined) {
    await syncProjectTypeForm(deps.registry, tx, created.id, dto.form);
  }
  await emitProjectTypeChanged(deps.eventBus, tx, created.id, 'created', Object.keys(dto), actorId);
  return created;
}

/** Правка типа проекта: имя, форма (слоты → привязки), допустимые виды.
 *  Снятые слоты снимают только свои привязки (#646). */
export async function updateProjectType(
  deps: {
    types: ProjectTypesRepository;
    nodeKinds: NodeKindsRepository;
    registry: CustomFieldRegistry;
    eventBus: EventBus;
  },
  tx: TransactionClient,
  id: string,
  dto: ProjectTypeUpdateBody,
  actorId: string,
): Promise<ProjectType> {
  // Лок справочника — на любой PATCH: имя, форма и привязки сериализуются
  // между собой (как у видов папок; #646).
  await deps.types.lockForms(tx);
  // 404 — до валидации формы (#646): PATCH несуществующего типа с битой
  // формой обязан отвечать 404, а не 422. Чтение — в транзакции под локом:
  // прежняя форма (дельта снятых слотов) не должна устареть.
  const current = await deps.types.findById(id, tx);
  if (!current) throw DomainException.notFound('Project type not found');
  let previousFormIds: string[] = [];
  if (dto.form !== undefined) {
    await assertProjectTypeForm(deps.registry, tx, dto.form);
    previousFormIds = current.form.fields.map((slot) => slot.fieldId);
  }
  if (dto.name !== undefined && (await deps.types.nameTaken(dto.name, id, tx))) {
    throw DomainException.conflict('Project type name is already taken');
  }
  if (dto.kindIds !== undefined && dto.kindIds !== null) {
    const alive = await deps.nodeKinds.activeByIds(dto.kindIds);
    if (alive.length !== new Set(dto.kindIds).size) {
      throw new DomainException(ErrorCode.PROJECT_NODE_INVALID, 'Node kind is not available', {
        typeId: id,
      });
    }
  }
  const updated = await deps.types.update(tx, id, dto);
  if (!updated) throw DomainException.notFound('Project type not found');
  if (dto.form !== undefined) {
    await syncProjectTypeForm(deps.registry, tx, id, dto.form, previousFormIds);
  }
  await emitProjectTypeChanged(deps.eventBus, tx, id, 'updated', Object.keys(dto), actorId);
  return updated;
}
