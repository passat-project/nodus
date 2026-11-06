import type { AuthUser, CustomFieldValues, UpdateProjectBody } from '@nodus/contracts';
import {
  clearedProjectFields,
  ErrorCode,
  Permission,
  projectTypeFormOf,
  PROJECT_LIMITS,
  SYSTEM_FIELD_IDS,
} from '@nodus/contracts';

import type { Prisma } from '../../generated/prisma/client.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import type { UserProfileReader } from '../../core/ports/user-profile.port.js';
import type { CustomFieldRegistry } from '../custom-fields/ports/custom-field-registry.port.js';
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
  },
  user: AuthUser,
  row: ProjectRow,
  facts: ProjectFacts,
  body: UpdateProjectBody,
): Promise<{ patch: ProjectFieldsPatch; fields: string[]; assistantIds: string[] | null }> {
  const patch: ProjectFieldsPatch = {};
  const fields: string[] = [];
  if (body.name !== undefined) {
    patch.name = body.name;
    fields.push('name');
  }
  if (body.description !== undefined) {
    patch.description = body.description ?? '';
    fields.push('description');
  }
  if (body.color !== undefined) {
    patch.color = body.color;
    fields.push('color');
  }
  if (body.portfolioId !== undefined) {
    if (body.portfolioId && !(await ctx.groups.findActive(body.portfolioId))) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Unknown portfolio');
    }
    patch.portfolioId = body.portfolioId ?? null;
    fields.push('portfolioId');
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
  if (body.startDate !== undefined) {
    patch.startedAt = body.startDate ? new Date(body.startDate) : null;
    fields.push('startDate');
  }
  if (body.endDate !== undefined) {
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
    patch.assistantIds = assistantIds as Prisma.InputJsonValue;
    fields.push('assistantIds');
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
    const form = type ? projectTypeFormOf(type) : { fields: [] };
    const prepared = await ctx.customFields.prepareUpdate({
      current: row.customFields as CustomFieldValues,
      patch: patchBody,
      actor: user,
      target: { kind: 'project_type', id: row.typeId },
    });
    const cleared = clearedProjectFields(
      form.fields.filter((slot) => slot.state === 'required').map((slot) => slot.fieldId),
      patchBody,
    );
    if (cleared.length > 0) {
      throw new DomainException(
        ErrorCode.PROJECT_FIELDS_REQUIRED,
        'Required project fields cannot be cleared',
        {
          typeId: row.typeId,
          fields: cleared,
          reason: 'clear',
        },
      );
    }
    patch.customFields = prepared.next as Prisma.InputJsonValue;
    const changedFields = [...prepared.changes.map((change) => `cf.${change.fieldId}`)];
    if (body.code !== undefined && !changedFields.includes(`cf.${SYSTEM_FIELD_IDS.projectCode}`)) {
      changedFields.push(`cf.${SYSTEM_FIELD_IDS.projectCode}`);
    }
    if (
      body.clientId !== undefined &&
      !changedFields.includes(`cf.${SYSTEM_FIELD_IDS.projectClient}`)
    ) {
      changedFields.push(`cf.${SYSTEM_FIELD_IDS.projectClient}`);
    }
    fields.push(...changedFields);
  }
  return { patch, fields, assistantIds };
}
