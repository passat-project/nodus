/* eslint-disable nodus-internal/max-lines-warn -- создание проекта (#630): место счёта и запись — одна транзакция */
import { Inject, Injectable } from '@nestjs/common';
import {
  customFieldKey,
  ErrorCode,
  Permission,
  PROJECT_EVENTS,
  PROJECT_LIMITS,
  SYSTEM_FIELD_IDS,
  effectiveProjectTypeForm,
  missingProjectFields,
  type AuthUser,
  type CreateProjectBody,
  type ProjectDetail,
  type UpdateProjectBody,
} from '@nodus/contracts';

import type { Prisma } from '../../generated/prisma/client.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { USER_PROFILE_READER, type UserProfileReader } from '../../core/ports/user-profile.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../custom-fields/ports/custom-field-registry.port.js';
import { FORMULA_CELLS, type FormulaCells } from '../custom-fields/ports/formula-cells.port.js';
import type { ProjectFacts } from './project-access.js';
import { projectAudience } from './project-audience.js';
import { ProjectFormulaRecalcService } from './project-formula-recalc.service.js';
import { clientOf, codeOf, legacyToAttributes } from './project-legacy-fields.js';
import { buildUpdatePatch } from './project-update-patch.js';
import { ProjectsQueryService } from './projects-query.service.js';
import { ProjectGroupsRepository } from './project-groups.repository.js';
import { ProjectMembersService } from './project-members.service.js';
import { ProjectParticipantsRepository } from './project-participants.repository.js';
import { ProjectTypesRepository } from './project-types.repository.js';
import { ProjectsRepository, type ProjectRow } from './projects.repository.js';
import {
  NUMBER_ISSUE,
  numberingFailureException,
  type NumberIssue,
} from '../custom-fields/ports/number-issue.port.js';

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
    // Снятие формулы ячейки при обычной записи значения (Р5 #632).
    @Inject(FORMULA_CELLS) private readonly formulaCells: FormulaCells,
    private readonly formulaRecalc: ProjectFormulaRecalcService,
    @Inject(NUMBER_ISSUE) private readonly numberIssue: NumberIssue,
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
      // истина, как у задач и папок. Форма — эффективная: слот удалённого
      // атрибута не блокирует создание (#646).
      const boundDefinitions = await this.customFields.definitions(
        { target: { kind: 'project_type', id: body.typeId } },
        tx,
      );
      const missing = missingProjectFields(effectiveProjectTypeForm(type, boundDefinitions), {
        customFields,
      });
      if (missing.length > 0) {
        throw new DomainException(
          ErrorCode.PROJECT_FIELDS_REQUIRED,
          'Required project fields are missing',
          {
            typeId: type.id,
            fields: missing.map(customFieldKey),
            reason: 'create',
          },
        );
      }
      // Счётчики «при создании» (#630): портфель/тип — место счёта;
      // отказ — проект не создаётся, номера не тратятся.
      const numberPlan = await this.numberIssue.planOnCreate(
        tx,
        {
          host: 'project',
          typeId: body.typeId,
          folders: [],
          projectId: null,
          portfolioId: body.portfolioId ?? null,
          projectTypeId: body.typeId,
          parentTaskId: null,
          sources: { self: customFields },
        },
        {
          source: 'create',
          values: customFields,
          confirmEmpty: body.confirmEmptyNumberParts === true,
          actorId: user.id,
        },
      );
      if (!numberPlan.ok) throw numberingFailureException(numberPlan.failure);
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
      const numbers = await numberPlan.issue(tx, row.id);
      if (Object.keys(numbers).length > 0) {
        await this.repo.update(tx, row.id, {
          customFields: { ...customFields, ...numbers } as Prisma.InputJsonValue,
        });
      }
      await this.members.syncManagement(tx, row.id, { managerId, assistantIds }, { notify: false });
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
          code: codeOf(customFields),
          managerId,
          assistantIds,
          clientId: clientOf(customFields),
          visibility,
          typeId: row.typeId,
          observerIds,
          audience: [...new Set([user.id, managerId, ...assistantIds, ...observerIds])],
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
    // Патч строится В ТРАНЗАКЦИИ по свежей строке под FOR UPDATE (#646):
    // иначе два параллельных PATCH теряют значения JSONB друг друга, а
    // PATCH поверх cleanup воскрешает ключ удалённого атрибута.
    const { patch } = await this.txRunner.run(async (tx) => {
      const locked = await this.repo.lockForUpdate(tx, id);
      if (!locked) throw DomainException.notFound('Project not found');
      const fresh = await this.repo.findById(id, tx);
      if (!fresh) throw DomainException.notFound('Project not found');
      if (fresh.status === 'archived' && !user.permissions.includes(Permission.PROJECT_MANAGE)) {
        throw DomainException.forbidden('Archived project fields are managed by project.manage');
      }
      const built = await buildUpdatePatch(
        {
          groups: this.groups,
          profiles: this.profiles,
          types: this.types,
          customFields: this.customFields,
          formulaCells: this.formulaCells,
        },
        user,
        fresh,
        this.factsOf(fresh),
        body,
        tx,
      );
      const next = await this.repo.update(tx, id, built.patch);
      if (built.assistantIds !== null) {
        await this.members.syncManagement(tx, id, {
          managerId: next.managerId,
          assistantIds: built.assistantIds,
        });
      }
      // Уход в секретность: состав становится полностью ручным В ТОЙ ЖЕ
      // транзакции — без окна, где проект уже скрыт, а бывшие участники
      // задач/самовступившие наблюдатели ещё держат доступ.
      if (built.patch.visibility === 'secret') {
        await this.members.dropOpenRoster(tx, id);
      }
      // Раскрытие: ручной состав секретного снимается в той же транзакции —
      // состав открытого проекта живёт из задач (#714); строка истории о
      // смене видимости получит системную причину очистки (#699).
      if (built.patch.visibility === 'open') {
        await this.members.dropManualRoster(tx, id);
      }
      const nextValues =
        (built.patch.customFields as Prisma.JsonValue | undefined) ?? fresh.customFields;
      // Синхронный пересчёт формул проекта в той же tx (#632): ответ PATCH
      // несёт свежие значения — обработчик опаздывает на цикл диспетчера.
      const changedFieldIds = built.fields
        .filter((field) => field.startsWith('cf.'))
        .map((field) => field.slice(3));
      if (changedFieldIds.length > 0) {
        await this.formulaRecalc.recalcProjectAfterValuesChange(tx, user.id, id, changedFieldIds);
      }
      // Правка без реальных отличий (окно отправляет форму целиком) — не
      // событие: история не пересказывает тело запроса (#699).
      if (built.fields.length > 0) {
        await this.eventBus.emit(
          tx,
          PROJECT_EVENTS.UPDATED,
          {
            projectId: id,
            fields: built.fields,
            ...(built.patch.name !== undefined ? { name: built.patch.name } : {}),
            ...(built.fields.some((field) => field === `cf.${SYSTEM_FIELD_IDS.projectCode}`)
              ? { code: codeOf(nextValues) }
              : {}),
            ...(built.fields.some((field) => field === `cf.${SYSTEM_FIELD_IDS.projectClient}`)
              ? {
                  clientId: clientOf(nextValues),
                  previousClientId: clientOf(fresh.customFields),
                }
              : {}),
            audience: [
              ...new Set([...(await projectAudience(this.participantsRepo, next, tx)), user.id]),
            ],
          },
          { actorId: user.id, aggregateType: 'project', aggregateId: id },
        );
      }
      return { patch: built.patch };
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
