import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AuthUser,
  ListTasksQuery,
  Paginated,
  TaskBranch,
  TaskBranchNode,
  TaskChainNode,
  TaskDetail,
  TaskListItem,
  TaskStageWithCount,
  ProjectRef,
} from '@nodus/contracts';
import { normalizeTypeConfig, requiredCreateKeys } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { decodeCursor, encodeCursor } from '../../../core/pagination/cursor.util.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { actorRoles, taskAccess } from '../access/task-access.js';
import { ViewerResolver, visibleTasksWhere, type Viewer } from '../access/task-visibility.js';
import { PROJECT_READER, type ProjectReader } from '../../projects/ports/project-reader.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../../custom-fields/ports/custom-field-registry.port.js';
import { FORMULA_CELLS, type FormulaCells } from '../../custom-fields/ports/formula-cells.port.js';
import { selfChainNode, stageDto, TaskDtoMapper } from './task-dto.mapper.js';
import { withFormulaState } from './task-formula-state.js';
import { stagesCatalog } from './task-stages-catalog.js';
import { TasksQueryRepository, type TaskOrder } from './tasks-query.repository.js';
import { TasksRepository } from './tasks.repository.js';
import { detailFieldLocks, detailLockKeys, detailLockUserIds } from './task-field-locks.dto.js';
import { CHAT_MESSAGE_ACCESS, type ChatMessageAccess } from '../../chat/message-access.port.js';
import { ResultsRepository } from '../activity/results.repository.js';
import { PressRoundsService } from '../press/press-rounds.service.js';

const keyCursor = z.object({ o: z.string(), id: z.uuid() });
const numberCursor = z.object({ n: z.number().int() });
/** Потолок подзадач в карточке (ранние — первыми, порядок номеров). */
const SUBTASKS_LIMIT = 200;

/**
 * Чтения задач (CQRS-лайт): списки-фиды обеих осей, деталь, ветка, каталоги
 * стадий со счётчиками. Всё — через ЕДИНУЮ функцию видимости.
 */
@Injectable()
export class TasksQueryService {
  constructor(
    private readonly repo: TasksRepository,
    private readonly reads: TasksQueryRepository,
    private readonly results: ResultsRepository,
    private readonly viewers: ViewerResolver,
    private readonly mapper: TaskDtoMapper,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(CHAT_MESSAGE_ACCESS) private readonly messages: ChatMessageAccess,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    @Inject(FORMULA_CELLS) private readonly formulas: FormulaCells,
    private readonly press: PressRoundsService,
    private readonly txRunner: TransactionRunner,
  ) {}

  viewer(user: Pick<AuthUser, 'id' | 'permissions'>): Promise<Viewer> {
    return this.viewers.resolve(user);
  }

  /** Ссылки проектов задач для смотрящего: невидимые — пропущены (Т1). */
  private async projectsRefsFor(
    user: Pick<AuthUser, 'id' | 'permissions'>,
    rows: readonly { projectId: string | null }[],
  ): Promise<Map<string, ProjectRef>> {
    const ids = [
      ...new Set(rows.map((r) => r.projectId).filter((id): id is string => Boolean(id))),
    ];
    if (ids.length === 0) return new Map();
    const refs = await this.projects.refsFor(user, ids);
    return new Map(refs.map((ref) => [ref.id, ref]));
  }

  /** Задача, видимая пользователю, или 404 (чужое = «не найдено», без утечки). */
  async visibleRow(user: Pick<AuthUser, 'id' | 'permissions'>, id: string) {
    const viewer = await this.viewer(user);
    const row = await this.repo.findOne(
      { AND: [{ id }, visibleTasksWhere(viewer, 'all')] },
      user.id,
    );
    if (!row) throw DomainException.notFound('Task not found');
    return row;
  }

  /** id поддерева задачи (сам корень + живые потомки) — прокси репозитория
   *  для модулей-потребителей (#632 move-preview). */
  subtreeIds(id: string): Promise<string[]> {
    return this.reads.subtreeIds(id);
  }

  /** Видимые пользователю id из набора — ОДНИМ запросом (как ветка), а не
   *  N вызовами `visibleRow`: move-preview поддерева не должен стоить
   *  сотни запросов (#632, Р7). */
  async visibleIdsAmong(
    user: Pick<AuthUser, 'id' | 'permissions'>,
    ids: readonly string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const viewer = await this.viewer(user);
    return this.reads.visibleIdsAmong([...ids], visibleTasksWhere(viewer, 'all'));
  }

  async list(user: AuthUser, q: ListTasksQuery): Promise<Paginated<TaskListItem>> {
    const viewer = await this.viewer(user);
    const me = user.id;
    const order = this.order(q, me);
    // Пресет «Ждут моего решения» (#433): серверный фильтр по держателям шага;
    // scope принудительно all — при default mine задачи вне участия отсеклись бы.
    const scope = q.role === 'decider' ? 'all' : q.scope;
    const deciderWhere: Prisma.TaskWhereInput[] =
      q.role === 'decider' ? [{ id: { in: [...(viewer.deciderTaskIds ?? [])] } }] : [];
    const { rows, sortKeys } = await this.reads.list(
      {
        AND: [
          visibleTasksWhere(viewer, scope),
          ...deciderWhere,
          ...this.reads.feedFilters(q, me, new Date()),
        ],
      },
      order,
      q.limit,
      me,
    );
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    let nextCursor: string | null = null;
    if (rows.length > q.limit && last) {
      nextCursor =
        order.kind === 'number'
          ? encodeCursor({ n: last.number })
          : encodeCursor({ o: sortKeys.get(last.id)!, id: last.id });
    }
    const items = await this.mapper.toListItems(page, undefined, user);
    return {
      items: await withFormulaState(this.formulas, items, {
        registry: this.customFields,
        actor: user,
      }),
      nextCursor,
    };
  }

  private order(q: ListTasksQuery, me: string): TaskOrder {
    if (q.personalStageId) {
      const after = q.cursor ? decodeCursor(q.cursor, keyCursor) : undefined;
      return { kind: 'personal', userId: me, stageId: q.personalStageId, after };
    }
    if (q.stageId) {
      return { kind: 'stage', after: q.cursor ? decodeCursor(q.cursor, keyCursor) : undefined };
    }
    return { kind: 'number', after: q.cursor ? decodeCursor(q.cursor, numberCursor) : undefined };
  }

  async detail(user: AuthUser, id: string): Promise<TaskDetail> {
    const row = await this.visibleRow(user, id);
    // Ленивый старт раунда сбора (#434) для задач, вошедших в стадию до
    // релиза: карточка сразу видит прогресс, а не «мёртвую» коллективную
    // кнопку. Повторный вызов идемпотентен (открытый раунд уже есть).
    await this.txRunner.run(async (tx) => this.press.ensureForStage(tx, id, row.stageId));
    const viewer = await this.viewer(user);
    const [full, children, result] = await Promise.all([
      this.reads.findDetail(id),
      this.reads.listSubtasks(id, visibleTasksWhere(viewer, 'all'), SUBTASKS_LIMIT, user.id),
      this.results.findCurrent(id),
    ]);
    const observerIds = row.participants.filter((p) => p.role === 'observer').map((p) => p.userId);
    // Состав карточки по типу (#432, Р7): сервер собирает его сам, поэтому
    // он работает и для типа, невидимого зрителю (имя типа не раскрывается).
    const type = await this.catalog.typeById(row.typeId);
    // Замки записи (#496, Р10): только ключи ТЕКУЩЕГО типа — атрибут могли
    // снять с типа, и его замок в карточке уже мёртв (не показывается).
    const boundFieldIds = new Set(
      (
        await this.customFields.definitions({
          target: { kind: 'process_type', id: row.typeId },
        })
      ).map((definition) => definition.id),
    );
    // Право пути — часть `canEdit` замка (Р10): без него PATCH даст 403.
    const access = taskAccess(actorRoles(row, user.id), user.permissions);
    const lockKeys = detailLockKeys(row.fieldLocks, boundFieldIds);
    const refs = await this.mapper.refs([
      ...this.mapper.userIdsOf([row, ...children]),
      ...observerIds,
      ...(result ? [result.authorId] : []),
      ...detailLockUserIds(row.fieldLocks, lockKeys),
    ]);
    const catalog = await this.mapper.catalogOf([row, ...children]);
    // Проект задачи — ссылка видна только участнику секретного (Т1).
    const projectRefs = await this.projectsRefsFor(user, [row, ...children]);
    const cardConfig = normalizeTypeConfig(type?.config);
    const layout = {
      hiddenBlocks: cardConfig.card.hiddenBlocks,
      roleLabels: cardConfig.card.roleLabels,
      requiredKeys: type ? requiredCreateKeys(type.creationForm) : [],
    };
    const origin = [
      // Узлы чата строятся только при чтении (по правам смотрящего); старые
      // снимки в origin, если есть, не отдаются (security-гейт #37, р.3).
      ...((full.origin as TaskChainNode[] | null) ?? []).filter((n) => n.kind !== 'chat_message'),
      ...(full.source === 'chat_message' && full.sourceId
        ? [await this.messageNode(full.sourceId, user.id)]
        : []),
    ];
    // Один stateFor/снапшот на родителя и подзадач, ссылки — по эффективным
    // значениям (формула типа не лежит в строке): иначе fx есть, а имя
    // ссылки — «Запись недоступна».
    const withFormulas = await withFormulaState(
      this.formulas,
      [row, ...children].map((item) => this.mapper.toListItem(item, refs, catalog, projectRefs)),
      { registry: this.customFields, actor: user },
    );
    const [withFormulasParent, ...withFormulasChildren] = withFormulas;
    return {
      ...withFormulasParent!,
      // Свой маршрут задачи (по нему работают кнопки): тип может быть в
      // архиве — его задачи обязаны открываться (код-ревью #378).
      workflowId: full.workflowId,
      description: full.description,
      observers: observerIds.map((uid) => this.mapper.ref(refs, uid)),
      checklist: full.checklist.map((c) => ({ id: c.id, text: c.text, done: c.done })),
      subtasks: withFormulasChildren,
      chain: [
        ...origin,
        selfChainNode({
          ...row,
          stageName: catalog.stages.get(row.stageId)?.name ?? row.stageId,
        }),
      ],
      plannedMinutes: full.plannedMinutes,
      acceptRequired: full.acceptRequired,
      result: result
        ? {
            id: result.id,
            text: result.text,
            messageIds: result.messageIds as string[],
            author: this.mapper.ref(refs, result.authorId),
            createdAt: result.createdAt.toISOString(),
          }
        : null,
      completedAt: full.completedAt?.toISOString() ?? null,
      customFieldRefs: withFormulasParent?.customFieldRefs ?? [],
      layout,
      // Замки записи (#496, Р10): кто и почему закрепил, `canEdit` по
      // правилу замка без причины (окно причины решает клиент).
      fieldLocks: detailFieldLocks(
        row.fieldLocks,
        lockKeys,
        user,
        row.creatorId,
        access.canEdit,
        (userId) => this.mapper.ref(refs, userId),
      ),
      access,
      press: await this.press.viewForTask(full.id, full.stageId, user.id, access.canEdit),
      createdAt: full.createdAt.toISOString(),
    };
  }

  /** Узел «сообщение чата» цепочки — по правам СМОТРЯЩЕГО: участник беседы
   *  видит её название и выдержку, остальные — нейтральную заглушку (снимок
   *  не хранится в задаче — иначе «В задачу» пересылал бы закрытую беседу
   *  исполнителю вне неё; security-гейт #37, р.2). */
  private async messageNode(messageId: string, viewerId: string): Promise<TaskChainNode> {
    const snap = await this.messages.snapshot(messageId, viewerId);
    return snap
      ? {
          kind: 'chat_message',
          ref: snap.conversationTitle ?? 'Чат',
          label: snap.excerpt || 'Сообщение чата',
          entityId: snap.conversationId,
        }
      : { kind: 'chat_message', ref: 'Чат', label: 'Сообщение чата' };
  }

  /** Ветка от корневого предка; невидимые узлы маскируются: только номер,
   *  без названия и стадии (#343 — ход чужих задач не раскрывается). */
  async branch(user: AuthUser, id: string): Promise<TaskBranch> {
    await this.visibleRow(user, id);
    const viewer = await this.viewer(user);
    let rootId = id;
    for (let guard = 0; guard < 50; guard++) {
      const parentId = await this.reads.parentIdOf(rootId);
      if (!parentId) break;
      rootId = parentId;
    }
    const ids = await this.reads.subtreeIds(rootId);
    const [rows, visible] = await Promise.all([
      this.reads.branchRows(ids),
      this.reads.visibleIdsAmong(ids, visibleTasksWhere(viewer, 'all')),
    ]);
    const seen = new Set(visible);
    const stages = new Map(
      (await this.catalog.stagesByIds([...new Set(rows.map((r) => r.stageId))])).map((s) => [
        s.id,
        s,
      ]),
    );
    const build = (nodeId: string): TaskBranchNode => {
      const r = rows.find((x) => x.id === nodeId)!;
      const visible = seen.has(r.id);
      const stageRow = stages.get(r.stageId);
      const stage = visible && stageRow ? stageDto(stageRow) : null;
      return {
        id: r.id,
        number: r.number,
        title: visible ? r.title : `ПП-${r.number}`,
        hidden: !visible,
        stageName: visible ? (stageRow?.name ?? null) : null,
        stageColor: stage?.color ?? null,
        systemState: stage?.systemState ?? null,
        children: rows.filter((c) => c.parentId === r.id).map((c) => build(c.id)),
      };
    };
    return { root: build(rootId) };
  }

  /** Каталог стадий со счётчиками: `typeId` — одного типа; без — всех
   *  живых типов с полями typeId/typeName (#378). Реализация — чистый
   *  помощник task-stages-catalog.ts. */
  async stages(
    user: AuthUser,
    scope: 'mine' | 'all',
    typeId?: string,
  ): Promise<TaskStageWithCount[]> {
    const viewer = await this.viewer(user);
    return stagesCatalog(
      this.catalog,
      () => this.reads.stageCounts(visibleTasksWhere(viewer, scope), new Date()),
      typeId,
      user.id,
    );
  }
}
