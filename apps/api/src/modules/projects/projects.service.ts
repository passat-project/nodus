import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  Permission,
  PROJECT_EVENTS,
  PROJECT_LIMITS,
  SYSTEM_FIELD_IDS,
  missingProjectFields,
  clearedProjectFields,
  projectTypeFormOf,
  type AuthUser,
  type CreateProjectBody,
  type CustomFieldValue,
  type ProjectDetail,
  type UpdateProjectBody,
} from '@nodus/contracts';

import type { CustomFieldValues } from '@nodus/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { USER_PROFILE_READER, type UserProfileReader } from '../../core/ports/user-profile.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../custom-fields/ports/custom-field-registry.port.js';
import type { ProjectFacts } from './project-access.js';
import { ProjectsQueryService } from './projects-query.service.js';
import { ProjectGroupsRepository } from './project-groups.repository.js';
import { ProjectMembersService } from './project-members.service.js';
import { ProjectParticipantsRepository } from './project-participants.repository.js';
import { ProjectTypesRepository } from './project-types.repository.js';
import {
  ProjectsRepository,
  type ProjectFieldsPatch,
  type ProjectRow,
} from './projects.repository.js';

const DEFAULT_VISIBILITY = 'open' as const;
const SETTING_VISIBILITY = 'projects.defaultVisibility';

/**
 * Ядро модуля (#52): журнал, карточка, создание, правка полей, статусы и
 * передача руководства. Участие — ProjectMembersService; события — outbox
 * в той же транзакции (I9). Права на мутации полей — руководство проекта
 * (руководитель + помощники) или project.manage (вердикт 29.10).
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly repo: ProjectsRepository,
    private readonly types: ProjectTypesRepository,
    private readonly groups: ProjectGroupsRepository,
    private readonly participantsRepo: ProjectParticipantsRepository,
    private readonly members: ProjectMembersService,
    private readonly queries: ProjectsQueryService,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
  ) {}

  async create(user: AuthUser, body: CreateProjectBody): Promise<ProjectDetail> {
    const managerId = body.managerId ?? user.id;
    const assistantIds = [...new Set(body.assistantIds ?? [])].filter((id) => id !== managerId);
    if (assistantIds.length > PROJECT_LIMITS.assistants) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Too many assistants');
    }
    // Наблюдатели задаются сразу при создании (вердикт 07.11.2026); руководство
    // наблюдателем быть не может — его ряд сильнее и уже есть.
    const observerIds = [...new Set(body.observers ?? [])].filter(
      (id) => id !== managerId && !assistantIds.includes(id),
    );
    const people = [...new Set([managerId, ...assistantIds, ...observerIds])];
    if ((await this.profiles.filterActiveUserIds(people)).length !== people.length) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Unknown or inactive user');
    }
    const type = await this.types.findActive(body.typeId);
    if (!type) throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Unknown project type');
    if (body.portfolioId && !(await this.groups.findActive(body.portfolioId))) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Unknown portfolio');
    }
    const visibility = body.visibility ?? (await this.defaultVisibility());
    const id = await this.txRunner.run(async (tx) => {
      // Шифр/заказчик — атрибуты (Р9 #631): legacy-поля тела переводятся в
      // значения системных атрибутов (десктоп), явное customFields важнее.
      const input = legacyToAttributes(body, body.customFields ?? {});
      const customFields = await this.customFields.prepareCreate(
        {
          input,
          authorId: user.id,
          actor: user,
          target: { kind: 'project_type', id: body.typeId },
        },
        tx,
      );
      // Обязательные слоты формы типа — после умолчаний (Р10): сервер —
      // истина, как у задач и папок.
      const missing = missingProjectFields(projectTypeFormOf(type), { customFields });
      if (missing.length > 0) {
        throw new DomainException(
          ErrorCode.PROJECT_FIELDS_REQUIRED,
          'Required project fields are missing',
          {
            typeId: type.id,
            fields: missing,
            reason: 'create',
          },
        );
      }
      const row = await this.repo.create(
        {
          name: body.name,
          description: body.description ?? '',
          color: body.color ?? 'blue',
          typeId: body.typeId,
          portfolioId: body.portfolioId ?? null,
          managerId,
          assistantIds: assistantIds as Prisma.InputJsonValue,
          visibility,
          creatorId: user.id,
          startedAt: body.startDate ? new Date(body.startDate) : null,
          endsAt: body.endDate ? new Date(body.endDate) : null,
          customFields: customFields as Prisma.InputJsonValue,
        },
        tx,
      );
      await this.members.syncManagement(tx, row.id, { managerId, assistantIds });
      if (observerIds.length > 0) {
        await this.participantsRepo.add(
          tx,
          observerIds.map((userId) => ({
            projectId: row.id,
            userId,
            source: 'observer' as const,
            observerKind: 'invited',
          })),
        );
        await this.members.emitChanged(tx, row.id, observerIds);
      }
      // Создатель, назначивший руководство другим, — наблюдатель-создатель
      // (Т5); создатель-руководитель уже в составе источником manager.
      if (managerId !== user.id) {
        await this.participantsRepo.add(tx, [
          { projectId: row.id, userId: user.id, source: 'observer', observerKind: 'creator' },
        ]);
      }
      await this.eventBus.emit(
        tx,
        PROJECT_EVENTS.CREATED,
        {
          projectId: row.id,
          name: row.name,
          code: row.code,
          managerId,
          assistantIds,
          clientId: row.clientId,
          visibility,
          typeId: row.typeId,
          observerIds,
        },
        { actorId: user.id, aggregateType: 'project', aggregateId: row.id },
      );
      return row.id;
    });
    return this.queries.detail(user, id);
  }

  async update(user: AuthUser, id: string, body: UpdateProjectBody): Promise<ProjectDetail> {
    const { row } = await this.loadForManage(user, id);
    // Архив — заморозка: поля правит только project.manage (Р1/Т6); вернуть
    // в работу руководитель может статусным действием.
    if (row.status === 'archived' && !user.permissions.includes(Permission.PROJECT_MANAGE)) {
      throw DomainException.forbidden('Archived project fields are managed by project.manage');
    }
    const facts = this.factsOf(row);
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
      if (body.portfolioId && !(await this.groups.findActive(body.portfolioId))) {
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
        (await this.profiles.filterActiveUserIds(assistantIds)).length !==
        new Set(assistantIds).size
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
      const type = await this.types.findById(row.typeId);
      const form = type ? projectTypeFormOf(type) : { fields: [] };
      const prepared = await this.customFields.prepareUpdate({
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
      if (
        body.code !== undefined &&
        !changedFields.includes(`cf.${SYSTEM_FIELD_IDS.projectCode}`)
      ) {
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
    await this.txRunner.run(async (tx) => {
      const next = await this.repo.update(tx, id, patch);
      if (assistantIds !== null) {
        await this.members.syncManagement(tx, id, { managerId: next.managerId, assistantIds });
      }
      // Уход в секретность: состав становится полностью ручным В ТОЙ ЖЕ
      // транзакции — без окна, где проект уже скрыт, а бывшие участники
      // задач/самовступившие наблюдатели ещё держат доступ.
      if (patch.visibility === 'secret') {
        await this.members.dropOpenRoster(tx, id);
      }
      await this.eventBus.emit(
        tx,
        PROJECT_EVENTS.UPDATED,
        {
          projectId: id,
          fields,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(fields.some((field) => field === `cf.${SYSTEM_FIELD_IDS.projectClient}`)
            ? {
                clientId: clientOf(
                  (patch.customFields as Prisma.JsonValue | undefined) ?? row.customFields,
                ),
                previousClientId: clientOf(row.customFields),
              }
            : {}),
        },
        { actorId: user.id, aggregateType: 'project', aggregateId: id },
      );
    });
    if (patch.visibility === 'open') {
      await this.members.recomputeTaskSource(id);
    }
    return this.queries.detail(user, id);
  }

  // ===== Настройки портала (Р7) =====

  /** Дефолт видимости новых проектов: настройка портала, дефолт кода 'open'. */
  async defaultVisibility(): Promise<'open' | 'secret'> {
    const value = await this.repo.settingValue(SETTING_VISIBILITY);
    return value === 'secret' ? 'secret' : DEFAULT_VISIBILITY;
  }

  async putDefaultVisibility(value: 'open' | 'secret'): Promise<void> {
    await this.repo.putSetting(SETTING_VISIBILITY, value as Prisma.InputJsonValue);
  }

  factsOf(row: ProjectRow): ProjectFacts {
    return {
      managerId: row.managerId,
      assistantIds: Array.isArray(row.assistantIds) ? (row.assistantIds as string[]) : [],
      visibility: row.visibility as ProjectFacts['visibility'],
      status: row.status as ProjectFacts['status'],
    };
  }

  /** Видимость карточки: секретный — участие или view_secret; открытый —
   *  всем. 404 без оракула (Т1). */
  async assertVisible(user: AuthUser, id: string): Promise<ProjectRow> {
    const row = await this.repo.findById(id);
    if (!row) throw DomainException.notFound('Project not found');
    if (row.visibility === 'secret') {
      const mine = await this.participantsRepo.hasRow(id, user.id);
      if (!mine && !user.permissions.includes(Permission.PROJECT_VIEW_SECRET)) {
        throw DomainException.notFound('Project not found');
      }
    }
    return row;
  }

  /** Проект + проверка прав управления (поля/статусы): используют и lifecycle-действия. */
  async loadForManage(user: AuthUser, id: string) {
    const row = await this.assertVisible(user, id);
    const rows = await this.participantsRepo.rowsOfProject(id);
    const isManagement = rows.some(
      (p) => p.userId === user.id && (p.source === 'manager' || p.source === 'assistant'),
    );
    if (!isManagement && !user.permissions.includes(Permission.PROJECT_MANAGE)) {
      throw DomainException.forbidden('Only project management can edit the project');
    }
    return { row };
  }
}

/** Шифр проекта из значений атрибутов (системный «Шифр», Р9 #631). */
export function codeOf(customFields: unknown): string | null {
  const value = attributeValue(customFields, SYSTEM_FIELD_IDS.projectCode);
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Заказчик проекта из значений атрибутов (системный «Заказчик», Р9 #631). */
export function clientOf(customFields: unknown): string | null {
  const value = attributeValue(customFields, SYSTEM_FIELD_IDS.projectClient);
  return typeof value === 'string' && value !== '' ? value : null;
}

function attributeValue(customFields: unknown, fieldId: string): unknown {
  if (customFields === null || typeof customFields !== 'object') return null;
  return (customFields as Record<string, unknown>)[fieldId] ?? null;
}

/** Legacy-поля создания → значения системных атрибутов (десктоп ещё шлёт
 *  code/clientId сверху; явное customFields важнее — Class А #631). */
function legacyToAttributes(
  body: { code?: string; clientId?: string | null },
  customFields: CustomFieldValues,
): CustomFieldValues {
  const next = { ...customFields };
  if (body.code && next[SYSTEM_FIELD_IDS.projectCode] === undefined) {
    next[SYSTEM_FIELD_IDS.projectCode] = body.code;
  }
  if (body.clientId && next[SYSTEM_FIELD_IDS.projectClient] === undefined) {
    next[SYSTEM_FIELD_IDS.projectClient] = body.clientId;
  }
  return next;
}

/** Legacy-поля правки → патч атрибутов: null очищает (канон custom-fields). */
function legacyPatchToAttributes(
  body: { code?: string | null; clientId?: string | null },
  customFields: Record<string, CustomFieldValue | null>,
): Record<string, CustomFieldValue | null> {
  const next = { ...customFields };
  if (body.code !== undefined && next[SYSTEM_FIELD_IDS.projectCode] === undefined) {
    next[SYSTEM_FIELD_IDS.projectCode] = body.code;
  }
  if (body.clientId !== undefined && next[SYSTEM_FIELD_IDS.projectClient] === undefined) {
    next[SYSTEM_FIELD_IDS.projectClient] = body.clientId;
  }
  return next;
}
