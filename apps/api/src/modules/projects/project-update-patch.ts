import type { AuthUser, CustomFieldValues, UpdateProjectBody } from '@nodus/contracts';
import {
  clearedProjectFields,
  customFieldKey,
  effectiveProjectTypeForm,
  ErrorCode,
  Permission,
  PROJECT_LIMITS,
  formSlots,
} from '@nodus/contracts';

import type { Prisma } from '../../generated/prisma/client.js';
import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import type { UserProfileReader } from '../../core/ports/user-profile.port.js';
import type { CustomFieldRegistry } from '../custom-fields/ports/custom-field-registry.port.js';
import type { FormulaCells } from '../custom-fields/ports/formula-cells.port.js';
import type { ProjectFacts } from './project-access.js';
import { legacyPatchToAttributes } from './project-legacy-fields.js';
import type { ProjectGroupsRepository } from './project-groups.repository.js';
import type { ProjectTypesRepository } from './project-types.repository.js';
import type { ProjectFieldsPatch, ProjectRow } from './projects.repository.js';

/**
 * Сборка патча полей правки проекта (#52/#631): скалярные поля, видимость,
 * ассистенты и слияние атрибутов (legacy `code`/`clientId` + customFields
 * → один патч реестра, обязательные слоты формы типа нельзя очистить).
 * Вынесено из ProjectsService.update ради лимита строк файла (I5);
 * логика прежняя, зависимости передаются явно.
 */
export async function buildUpdatePatch(
  ctx: {
    groups: ProjectGroupsRepository;
    profiles: UserProfileReader;
    types: ProjectTypesRepository;
    customFields: CustomFieldRegistry;
    /** Проверка формульной блокировки ячейки при записи значения (#660). */
    formulaCells: Pick<FormulaCells, 'lockedFieldIds'>;
  },
  user: AuthUser,
  row: ProjectRow,
  facts: ProjectFacts,
  body: UpdateProjectBody,
  tx?: TransactionClient,
): Promise<{ patch: ProjectFieldsPatch; fields: string[]; assistantIds: string[] | null }> {
  const patch: ProjectFieldsPatch = {};
  const fields: string[] = [];
  // В fields попадают только РЕАЛЬНЫЕ отличия от строки проекта (#699):
  // окно правки шлёт форму целиком, и история не должна пересказывать тело
  // запроса нетронутыми полями.
  if (body.name !== undefined && body.name !== row.name) {
    patch.name = body.name;
    fields.push('name');
  }
  if (body.description !== undefined && (body.description ?? '') !== row.description) {
    patch.description = body.description ?? '';
    fields.push('description');
  }
  if (body.color !== undefined && body.color !== row.color) {
    patch.color = body.color;
    fields.push('color');
  }
  if (body.portfolioId !== undefined) {
    if (body.portfolioId && !(await ctx.groups.findActive(body.portfolioId))) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Unknown portfolio');
    }
    const nextPortfolioId = body.portfolioId ?? null;
    if (nextPortfolioId !== row.portfolioId) {
      patch.portfolioId = nextPortfolioId;
      fields.push('portfolioId');
    }
  }
  if (body.visibility !== undefined && body.visibility !== row.visibility) {
    // Смена видимости на секретный — только действующий руководитель
    // (допущение #52); раскрыть проект может и помощник.
    if (
      body.visibility === 'secret' &&
      facts.managerId !== user.id &&
      !user.permissions.includes(Permission.PROJECT_MANAGE)
    ) {
      throw DomainException.forbidden('Only the manager can make the project secret');
    }
    patch.visibility = body.visibility;
    fields.push('visibility');
  }
  if (body.startDate !== undefined && !sameIsoDate(row.startedAt, body.startDate)) {
    patch.startedAt = body.startDate ? new Date(body.startDate) : null;
    fields.push('startDate');
  }
  if (body.endDate !== undefined && !sameIsoDate(row.endsAt, body.endDate)) {
    patch.endsAt = body.endDate ? new Date(body.endDate) : null;
    fields.push('endDate');
  }
  let assistantIds: string[] | null = null;
  if (body.assistantIds !== undefined) {
    assistantIds = [...new Set(body.assistantIds)].filter((aid) => aid !== facts.managerId);
    if (assistantIds.length > PROJECT_LIMITS.assistants) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Too many assistants');
    }
    if (
      (await ctx.profiles.filterActiveUserIds(assistantIds)).length !== new Set(assistantIds).size
    ) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Unknown or inactive user');
    }
    // Тот же набор помощников — не изменение: синк состава и строка истории
    // не нужны (#699).
    if (sameIds(facts.assistantIds, assistantIds)) {
      assistantIds = null;
    } else {
      patch.assistantIds = assistantIds as Prisma.InputJsonValue;
      fields.push('assistantIds');
    }
  }
  if (
    (body.customFields && Object.keys(body.customFields).length > 0) ||
    body.code !== undefined ||
    body.clientId !== undefined
  ) {
    // Шифр/заказчик — атрибуты: legacy-поля тела и customFields сливаются
    // в один патч (явное customFields важнее), затем общий конвейер.
    const patchBody = legacyPatchToAttributes(body, body.customFields ?? {});
    const type = await ctx.types.findById(row.typeId);
    // Эффективная форма: удалённый атрибут не должен требовать очистки
    // несуществующего слота (#646). Значения — в транзакции писателя.
    const definitions = await ctx.customFields.definitions(
      { target: { kind: 'project_type', id: row.typeId } },
      tx,
    );
    const form = type ? effectiveProjectTypeForm(type, definitions) : { fields: [] };
    const prepared = await ctx.customFields.prepareUpdate(
      {
        current: row.customFields as CustomFieldValues,
        patch: patchBody,
        actor: user,
        target: { kind: 'project_type', id: row.typeId },
      },
      tx,
    );
    // Формульная ячейка руками не пишется (решение владельца по #660):
    // значение в атрибут со своей формулой или формулой типа — 422.
    // Только реально изменённые ключи: повтор того же значения ошибкой
    // не становится.
    if (tx && prepared.changes.length > 0) {
      const locked = await ctx.formulaCells.lockedFieldIds(
        tx,
        'project',
        row.id,
        prepared.changes.map((change) => change.fieldId),
      );
      if (locked.size > 0) {
        throw new DomainException(
          ErrorCode.FORMULA_CELL_LOCKED,
          'Formula cell value is computed by its formula',
          { fields: [...locked] },
          422,
        );
      }
    }
    const cleared = clearedProjectFields(
      formSlots(form)
        .filter((slot) => slot.state === 'required')
        .map((slot) => slot.fieldId),
      patchBody,
    );
    if (cleared.length > 0) {
      throw new DomainException(
        ErrorCode.PROJECT_FIELDS_REQUIRED,
        'Required project fields cannot be cleared',
        {
          typeId: row.typeId,
          fields: cleared.map(customFieldKey),
          reason: 'clear',
        },
      );
    }
    patch.customFields = prepared.next as Prisma.InputJsonValue;
    // Только реальные изменения реестра: повтор значения не создаёт строки
    // истории (#699). Legacy-ключи не досыпаются — реестр уже сравнил их.
    fields.push(...prepared.changes.map((change) => `cf.${change.fieldId}`));
  }
  return { patch, fields, assistantIds };
}

/** День даты строки (UTC) совпадает с ISO-датой тела. */
function sameIsoDate(current: Date | null, next: string | null): boolean {
  if (current === null) return next === null;
  return next !== null && current.toISOString().slice(0, 10) === next.slice(0, 10);
}

/** Равны ли множества идентификаторов. */
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((id) => b.has(id));
}
