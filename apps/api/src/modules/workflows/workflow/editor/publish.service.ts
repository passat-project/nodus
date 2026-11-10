import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  normalizeTypeConfig,
  Permission,
  WORKFLOW_EVENTS,
  type AuthUser,
  type PublishWorkflowBody,
  type PublishWorkflowResult,
  type SaveWorkflowLayoutBody,
  type SaveWorkflowLayoutResult,
  type WorkflowDetail,
} from '@nodus/contracts';

import type { Prisma } from '../../../../generated/prisma/client.js';
import {
  TransactionRunner,
  type TransactionClient,
} from '../../../../core/database/transaction-runner.js';
import { DomainException } from '../../../../core/errors/domain-exception.js';
import { EventBus } from '../../../../core/events/event-bus.js';
import {
  ROLE_MEMBERSHIP_READER,
  type RoleMembershipReader,
} from '../../../../core/ports/role-membership.port.js';
import {
  ORG_STRUCTURE_READER,
  type OrgStructureReader,
} from '../../../../core/ports/org-structure.port.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../../core/ports/user-profile.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../../../custom-fields/ports/custom-field-registry.port.js';
import {
  WORKFLOW_PRESS_ROUNDS_READER,
  type WorkflowPressRoundsReader,
} from '../../ports/workflow-press-rounds.port.js';
import { assertLetterCatalogEditable } from '../../catalog/letter-lock.js';
import { documentOf } from './document-of.js';
import { liveLayout, resolveLayout } from './layout.js';
import { applyPublishPlan } from './publish-apply.js';
import { assertPublishable } from './publish-checks.js';
import { publishSnapshot } from './publish-snapshot.js';
import {
  missingMigrations,
  planWorkflowPublish,
  type PlannerSnapshot,
} from './publish-planner.js';
import { WorkflowPublishRepository } from './publish.repository.js';
import { ProcessTypesRepository } from '../../types/process-types.repository.js';
import { WorkflowRepository, type LoadedWorkflow } from '../workflow.repository.js';
import { assertWorkflowVisible } from './workflow-visibility.js';
import { WorkflowEntityRegistry } from '../engine/entity-adapter.registry.js';

/**
 * Чтение и публикация маршрута (#378, ADR-0021; «Процессы» — ADR-0024).
 * Публикация — одна транзакция: блокировка строки, оптимистичная версия,
 * серверские проверки (uuid-принадлежность, цели переносов), план и
 * применение (архив вместо удаления), раскладка холста (общая для всех),
 * событие `workflow.published` — его outbox-обработчик ставит фоновый
 * перенос сущностей, который выполняет адаптер категории.
 */
@Injectable()
export class WorkflowEditorService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly workflows: WorkflowRepository,
    private readonly writes: WorkflowPublishRepository,
    private readonly eventBus: EventBus,
    private readonly adapters: WorkflowEntityRegistry,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    @Inject(ROLE_MEMBERSHIP_READER) private readonly membership: RoleMembershipReader,
    @Inject(ORG_STRUCTURE_READER) private readonly org: OrgStructureReader,
    private readonly types: ProcessTypesRepository,
    @Inject(WORKFLOW_PRESS_ROUNDS_READER) private readonly pressRounds: WorkflowPressRoundsReader,
  ) {}

  /** GET /workflows/:id — документ живого маршрута + счётчики. Маршрут
   *  скрытого типа читателю без `workflow.manage` не отдаётся (#432). */
  async read(
    workflowId: string,
    user: Pick<AuthUser, 'id' | 'permissions'>,
  ): Promise<WorkflowDetail> {
    const workflow = await this.findTypeWorkflow(workflowId);
    const [row, typeIds, category] = await Promise.all([
      this.workflows.load(workflowId),
      this.workflows.typeIdsOf(workflowId),
      this.workflows.categoryOf(workflowId),
    ]);
    await assertWorkflowVisible(this.types, this.membership, typeIds, user);
    const stageEntityCounts = await this.adapters
      .get(category)
      .countByStages(row.stages.map((s) => s.id));
    const refs = workflow.publishedById
      ? await this.profiles.findRefs([workflow.publishedById], undefined)
      : [];
    return {
      id: workflowId,
      typeIds,
      version: workflow.version,
      publishedAt: workflow.publishedAt?.toISOString() ?? null,
      publishedBy: refs[0] ?? null,
      // Значения скрытых полей формы — только настройщикам процессов.
      document: documentOf(row, workflow.layout, workflow.creation, {
        maskPresets: !user.permissions.includes(Permission.WORKFLOW_MANAGE),
      }),
      stageEntityCounts,
    };
  }

  /** POST /workflows/:id/publish — публикация документа. */
  async publish(
    user: AuthUser,
    workflowId: string,
    body: PublishWorkflowBody,
  ): Promise<PublishWorkflowResult> {
    return this.txRunner.run(async (tx) => {
      await this.workflows.lockForUpdate(tx, workflowId);
      const workflow = await this.findTypeWorkflow(workflowId, tx);
      // Каталог писем — только просмотр до #463/#464 (Р4).
      assertLetterCatalogEditable({
        category: await this.workflows.categoryOf(workflowId, tx),
        direction: await this.workflows.letterDirectionOf(workflowId, tx),
      });
      if (workflow.version !== body.baseVersion) {
        throw new DomainException(
          ErrorCode.WORKFLOW_VERSION_CONFLICT,
          'Workflow was published by someone else',
          { currentVersion: workflow.version },
        );
      }
      // Неизвестное поле в окне/гейте — ошибка публикации, скрытое в ОКНЕ —
      // предупреждение (в условии скрытое допустимо, Р7).
      const category = await this.workflows.categoryOf(workflowId, tx);
      // Форма создания проверяется против типа этого маршрута (#432): форма
      // ссылается на атрибуты, привязанные к типу, а пресеты — на живых.
      const typeIds = await this.workflows.typeIdsOf(workflowId, tx);
      const typeRows = typeIds.length > 0 ? await this.types.findByIds(typeIds) : [];
      // Маршрут может обслуживать несколько типов: привязки проверяются по
      // всем (пересечение), нумерация нужна каждому типу, который реально
      // пойдёт по маршруту (#646).
      const numberingConfigured =
        typeRows.length > 0 &&
        typeRows.every((row) => Boolean(normalizeTypeConfig(row.config).numbering));
      const loaded = await assertPublishable(
        { registry: this.customFields, profiles: this.profiles, org: this.org },
        {
          document: body.document,
          category,
          typeIds,
          numberingConfigured,
          migrations: body.migrations,
          tx,
          load: () => this.workflows.load(workflowId, tx),
        },
      );

      const snapshot = await this.snapshotOf(tx, loaded, category);
      const plan = planWorkflowPublish(snapshot, body.document, body.migrations);
      // Коллективная кнопка (#434): пока раунд открыт, менять/архивировать её
      // нельзя — движок при кворуме выполнил бы уже другой переход.
      const openPress = await this.pressRounds.openTransitionIds(workflowId, tx);
      const touched = [
        ...plan.transitionArchives.map((archive) => archive.transitionId),
        ...plan.transitionUpdates.map((update) => update.id),
      ].filter((transitionId) => openPress.has(transitionId));
      if (touched.length > 0) {
        throw new DomainException(
          ErrorCode.CONFLICT,
          'Press rounds are open for changed buttons',
          { transitionIds: touched },
        );
      }
      const gaps = missingMigrations(plan);
      if (gaps.length > 0) {
        throw new DomainException(
          ErrorCode.WORKFLOW_MIGRATION_REQUIRED,
          'Archived stages still have tasks',
          { stages: gaps },
        );
      }

      const now = new Date();
      const created = await applyPublishPlan(
        this.writes,
        tx,
        workflowId,
        body.document,
        plan,
        now,
      );
      const live = {
        stageIds: new Set(body.document.stages.map((s) => created.resolve(s.id)!)),
        transitionIds: new Set(
          body.document.transitions.map((t) => created.transitions.get(t.id) ?? t.id),
        ),
      };
      // Места уже стоящих элементов — у сервера: их пишет PUT .../layout (и
      // чужие правки, пока этот редактор был открыт, — ревью #378); из
      // документа — места новых элементов и пробелы без сохранённой записи.
      const fromDocument = resolveLayout(body.document.layout, created, live);
      const saved = liveLayout(workflow.layout, live);
      const layout = {
        stages: { ...fromDocument.stages, ...saved.stages },
        transitions: { ...fromDocument.transitions, ...saved.transitions },
      };
      const version = await this.writes.bumpVersion(tx, workflowId, {
        userId: user.id,
        at: now,
        layout: layout as Prisma.InputJsonValue,
        // Форма создания — часть документа: публикуется тем же шагом, что
        // стадии и кнопки (ADR-0024 п.5). null — форма по умолчанию.
        creation: (body.document.creation ?? null) as Prisma.InputJsonValue | null,
      });
      const moves = plan.moves.map((m) => ({
        fromStageId: m.fromStageId,
        toStageId: created.resolve(m.toDocId)!,
      }));
      await this.eventBus.emit(
        tx,
        WORKFLOW_EVENTS.PUBLISHED,
        {
          workflowId,
          typeIds: await this.workflows.typeIdsOf(workflowId, tx),
          version,
          category,
          moves,
          restates: plan.restates,
        },
        { actorId: user.id, aggregateType: 'workflow', aggregateId: workflowId },
      );
      return {
        version,
        publishedAt: now.toISOString(),
        scheduledMoves: plan.moves.reduce(
          (sum, move) => sum + (snapshot.taskCounts[move.fromStageId] ?? 0),
          0,
        ),
      };
    });
  }

  /**
   * PUT /workflows/:id/layout — расстановка холста без новой версии
   * (вердикт владельца 20.10: перестановка «для красоты» версию не выпускает).
   * Записи элементов СЛИВАЮТСЯ с сохранёнными (элемент заменяется целиком,
   * остальные остаются): запрос, ушедший до чужой/своей публикации, не
   * затирает места только что опубликованных статусов. Под той же
   * блокировкой строки, что публикация, и по живым элементам на момент
   * записи — записей удалённых статусов и кнопок не остаётся.
   */
  async saveLayout(
    user: AuthUser,
    workflowId: string,
    body: SaveWorkflowLayoutBody,
  ): Promise<SaveWorkflowLayoutResult> {
    return this.txRunner.run(async (tx) => {
      await this.workflows.lockForUpdate(tx, workflowId);
      const workflow = await this.findTypeWorkflow(workflowId, tx);
      // Расстановка холста письма — тоже правка каталога (Р4).
      assertLetterCatalogEditable({
        category: await this.workflows.categoryOf(workflowId, tx),
        direction: await this.workflows.letterDirectionOf(workflowId, tx),
      });
      const loaded = await this.workflows.load(workflowId, tx);
      const live = {
        stageIds: new Set(loaded.stages.map((s) => s.id)),
        transitionIds: new Set(loaded.transitions.map((t) => t.id)),
      };
      const current = liveLayout(workflow.layout, live);
      const layout = liveLayout(
        {
          stages: { ...current.stages, ...body.layout.stages },
          transitions: { ...current.transitions, ...body.layout.transitions },
        },
        live,
      );
      await this.writes.saveLayout(tx, workflowId, layout as Prisma.InputJsonValue);
      await this.eventBus.emit(
        tx,
        WORKFLOW_EVENTS.LAYOUT_CHANGED,
        { workflowId },
        { actorId: user.id, aggregateType: 'workflow', aggregateId: workflowId },
      );
      return { layout };
    });
  }

  /** Снимок живого маршрута для планировщика — вынесен в publish-snapshot.ts. */
  private snapshotOf(
    tx: TransactionClient,
    loaded: LoadedWorkflow,
    category: Awaited<ReturnType<WorkflowRepository['categoryOf']>>,
  ): Promise<PlannerSnapshot> {
    return publishSnapshot(tx, loaded, category, this.adapters);
  }

  /** Редактору доступны только маршруты типов — allow-list `task | letter`:
   *  личные доски «Моего плана» и шаблон — 404 (security #378; uuid
   *  personal-маршрутов API не отдаёт, гвард добивает), а любой новый `kind`
   *  не становится доступным молча. Личные маршруты — временное исключение
   *  модуля задач до #438/#439 (ADR-0024). */
  private async findTypeWorkflow(workflowId: string, tx?: TransactionClient) {
    const workflow = await this.workflows.findMeta(workflowId, tx);
    if (!workflow || !['task', 'letter'].includes(workflow.kind)) {
      throw DomainException.notFound('Workflow not found');
    }
    return workflow;
  }
}
