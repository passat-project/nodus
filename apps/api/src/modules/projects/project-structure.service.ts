import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  NODE_LIMITS,
  PROJECT_EVENTS,
  nodeFormKey,
  type AuthUser,
  type CreateProjectNodeBody,
  type CustomFieldValues,
  type ProjectNode,
  type ProjectStructureResponse,
  type UpdateProjectNodeBody,
  SYSTEM_FIELD_IDS,
} from '@nodus/contracts';

import { Prisma } from '../../generated/prisma/client.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
  type RegistryFieldChange,
} from '../custom-fields/ports/custom-field-registry.port.js';
import { FORMULA_CELLS, type FormulaCells } from '../custom-fields/ports/formula-cells.port.js';
import {
  TASK_PROJECT_READER,
  type TaskProjectReader,
} from '../tasks/ports/task-project-reader.port.js';
import { NodeFormPolicy } from './node-form.policy.js';
import { loadForStructureManage } from './project-structure.access.js';
import { assertKindAlive, assertParent, kindOf } from './project-structure.guards.js';
import { nodeToDto } from './project-structure.mapper.js';
import { eventValue, valuesOf } from './project-structure.values.js';
import { NodeKindsRepository } from './project-node-kinds.repository.js';
import { ProjectNodesRepository, type ProjectNodeRow } from './project-nodes.repository.js';
import { ProjectTypesRepository } from './project-types.repository.js';
import { ProjectsService } from './projects.service.js';
import {
  childrenByParent,
  limitError,
  nodeDepth,
  nodeInvalid,
  orderKeyFor,
  parentOf,
} from './project-structure.tree.js';

/**
 * Дерево проекта (#467, #556; ADR-0030 «Дополнение»): папки со свободной
 * вложенностью, задачи — листья (порт TASK_PROJECT_READER). Права — как у
 * правки полей (руководство или project.manage), архив — 400. Мутации — под
 * advisory-локом структуры, события project.node_* — outbox в той же tx (I9);
 * срез папок без курсора (≤1000) — исключение ADR-0030.
 *
 * Значения атрибутов папки: форма и проверка — NodeFormPolicy (одна точка),
 * ссылки — одна пачка `refsMany` на срез (О2); папка для правки читается
 * ВНУТРИ транзакции после лока (F2). Перенос — ProjectStructureMoveService,
 * DTO — mapper, чистые расчёты — project-structure.tree.ts.
 */
@Injectable()
export class ProjectStructureService {
  constructor(
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    private readonly projects: ProjectsService,
    private readonly nodes: ProjectNodesRepository,
    private readonly kinds: NodeKindsRepository,
    private readonly types: ProjectTypesRepository,
    private readonly policy: NodeFormPolicy,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly registry: CustomFieldRegistry,
    @Inject(TASK_PROJECT_READER) private readonly taskReader: TaskProjectReader,
    // Формулы ячеек папок (#632): состояние для DTO и снятие при записи (Р5).
    @Inject(FORMULA_CELLS) private readonly formulas: FormulaCells,
  ) {}

  /** GET /projects/:id/structure: папки (плоско, по order) + rollups + виды +
   *  ссылки значений одной пачкой (О2). */
  async structure(user: AuthUser, projectId: string): Promise<ProjectStructureResponse> {
    await this.projects.assertVisible(user, projectId);
    const [rows, rollups, kinds] = await Promise.all([
      this.nodes.listByProject(projectId),
      this.taskReader.nodeRollups(projectId),
      this.kinds.list(),
    ]);
    const byNode = new Map(rollups.map((rollup) => [rollup.nodeId, rollup]));
    // Формульное состояние всех папок среза — одним запросом (Р9). Ссылки —
    // по ЭФФЕКТИВНЫМ значениям: значение формулы вида не лежит в строке,
    // иначе имя ссылки в дереве было бы «Запись недоступна».
    const formulas = await this.formulas.stateFor(
      'node',
      rows.map((row) => row.id),
      undefined,
      new Map(rows.map((row) => [row.id, row.kindId])),
    );
    const customFieldRefs = await this.registry.refsMany(
      rows.map((row) => ({ ...valuesOf(row), ...(formulas.get(row.id)?.values ?? {}) })),
      user,
    );
    return {
      nodes: rows.map((row) => nodeToDto(row, byNode.get(row.id) ?? null, formulas.get(row.id))),
      kinds,
      customFieldRefs,
    };
  }

  async create(
    user: AuthUser,
    projectId: string,
    body: CreateProjectNodeBody,
  ): Promise<ProjectNode> {
    const created = await this.createMany(user, projectId, {
      parentId: body.parentId ?? null,
      kindId: body.kindId,
      names: [body.name],
      code: body.code,
      customFields: body.customFields,
    });
    return created[0]!;
  }

  /** Пакетное создание («Здания: поз. 1–3»): лимиты — на пакет целиком.
   *  Значения атрибутов общие; шифр у пачки один (первая папка) — при
   *  обязательном шифре вида пачка отклоняется (422, В1). */
  async createMany(
    user: AuthUser,
    projectId: string,
    body: {
      parentId: string | null;
      kindId: string;
      names: string[];
      code?: string;
      customFields?: CustomFieldValues;
    },
  ): Promise<ProjectNode[]> {
    const { row: project } = await loadForStructureManage(this.projects, user, projectId);
    return this.txRunner.run(async (tx) => {
      await this.nodes.lockStructure(tx, projectId);
      const tree = await this.nodes.listByProject(projectId, tx);
      const kind = await assertKindAlive(this.kinds, this.types, tx, project.typeId, body.kindId);
      const parent = assertParent(tree, body.parentId);
      if (body.names.length > NODE_LIMITS.nodesPerProject - tree.length) {
        throw limitError('nodes_per_project', NODE_LIMITS.nodesPerProject);
      }
      const siblings = childrenByParent(tree).get(parent?.id ?? null) ?? [];
      if (siblings.length + body.names.length > NODE_LIMITS.childrenPerParent) {
        throw limitError('children_per_parent', NODE_LIMITS.childrenPerParent);
      }
      const depth = parent ? nodeDepth(parentOf(tree), parent.id) + 1 : 1;
      if (depth > NODE_LIMITS.depth) throw limitError('depth', NODE_LIMITS.depth);
      // Умолчания формы и обязательные слоты (код — атрибут) — одна точка (Р6).
      const values = await this.policy.prepareCreate(
        kind,
        { code: body.code ?? null, customFields: body.customFields },
        user.id,
        user,
        tx,
      );
      const meta = { actorId: user.id, aggregateType: 'project_node' };
      const created: ProjectNodeRow[] = [];
      for (const name of body.names) {
        const orders = [...siblings.map((s) => s.order), ...created.map((s) => s.order)];
        const node = await this.nodes.create(tx, {
          projectId,
          parentId: parent?.id ?? null,
          kindId: kind.id,
          name,
          order: orderKeyFor(orders, null, 'end'),
          customFields: values as Prisma.InputJsonValue,
        });
        created.push(node);
        await this.eventBus.emit(
          tx,
          PROJECT_EVENTS.NODE_CREATED,
          {
            projectId,
            nodeId: node.id,
            parentId: node.parentId,
            kindId: node.kindId,
            name: node.name,
          },
          { ...meta, aggregateId: node.id },
        );
      }
      // Формульное состояние новых папок — сразу в DTO: иначе карточка
      // показывает формулу типа, но остаётся редактируемой до перезагрузки.
      const states = await this.formulas.stateFor(
        'node',
        created.map((node) => node.id),
        tx,
        new Map(created.map((node) => [node.id, node.kindId])),
      );
      return created.map((node) => nodeToDto(node, null, states.get(node.id)));
    });
  }

  /** Правка папки: имя/шифр(null очищает)/вид/значения атрибутов. Смена вида
   *  значения прежнего вида не стирает — они скрываются (Р6, В10). */
  async update(
    user: AuthUser,
    projectId: string,
    nodeId: string,
    body: UpdateProjectNodeBody,
  ): Promise<ProjectNode> {
    const { row: project } = await loadForStructureManage(this.projects, user, projectId);
    return this.txRunner.run(async (tx) => {
      await this.nodes.lockStructure(tx, projectId);
      // Чтение ВНУТРИ tx после лока (F2): гонка двух PATCH сериализуется.
      // Строковый лок узла — против bulk-уборки значений удалённого атрибута
      // (у неё другой advisory-ключ): иначе запись вернула бы стёртый ключ.
      await this.nodes.lockNode(tx, projectId, nodeId);
      const node = await this.nodes.findInProject(projectId, nodeId, tx);
      if (!node) throw nodeInvalid(nodeId);
      const kindChanged = body.kindId !== undefined && body.kindId !== node.kindId;
      const kind = kindChanged
        ? await assertKindAlive(this.kinds, this.types, tx, project.typeId, body.kindId!)
        : await kindOf(this.kinds, tx, node.kindId);
      const patch: {
        name?: string;
        kindId?: string;
        customFields?: Prisma.InputJsonValue;
      } = {};
      const fields: string[] = [];
      let changes: RegistryFieldChange[] = [];
      if (body.code !== undefined || body.customFields !== undefined || kindChanged) {
        const prepared = await this.policy.prepareUpdate(
          kind,
          { customFields: valuesOf(node) },
          { code: body.code, customFields: body.customFields },
          { authorId: user.id, actor: user, kindChanged },
          tx,
        );
        // Вписанное значение снимает формулу ячейки в той же tx (Р5 #632);
        // только реально изменённые ключи — Enter без правки формулу не
        // отменяет.
        if (prepared.changes.length > 0) {
          await this.formulas.release(
            tx,
            'node',
            nodeId,
            prepared.changes.map((change) => change.fieldId),
          );
        }
        patch.customFields = prepared.values as Prisma.InputJsonValue;
        changes = prepared.changes;
        fields.push(...changes.map((change) => nodeFormKey(change.fieldId)));
      }
      if (body.name !== undefined) {
        patch.name = body.name;
        fields.push('name');
      }
      if (kindChanged) {
        patch.kindId = kind.id;
        fields.push('kindId');
      }
      await this.nodes.update(tx, node.id, patch);
      await this.eventBus.emit(
        tx,
        PROJECT_EVENTS.NODE_UPDATED,
        {
          projectId,
          nodeId: node.id,
          fields,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(changes.some((change) => change.fieldId === SYSTEM_FIELD_IDS.nodeCode)
            ? { code: nodeCodeOf(patch.customFields as Prisma.InputJsonValue | undefined) }
            : {}),
          ...(patch.kindId !== undefined ? { kindId: patch.kindId } : {}),
          ...(changes.length > 0
            ? {
                customFieldChanges: changes.map((change) => ({
                  fieldId: change.fieldId,
                  from: eventValue(change.from),
                  to: eventValue(change.to),
                })),
              }
            : {}),
        },
        { actorId: user.id, aggregateType: 'project_node', aggregateId: node.id },
      );
      // Формульное состояние папки для DTO (значок fx и бейдж ошибки, Р9).
      const formulas = (
        await this.formulas.stateFor('node', [node.id], tx, new Map([[node.id, node.kindId]]))
      ).get(node.id);
      return nodeToDto({ ...node, ...patch } as ProjectNodeRow, null, formulas);
    });
  }

  /** Удаление пустой папки насовсем (архивации папок нет, вердикт 30.10). */
  async remove(user: AuthUser, projectId: string, nodeId: string): Promise<void> {
    await loadForStructureManage(this.projects, user, projectId);
    await this.txRunner.run(async (tx) => {
      await this.nodes.lockStructure(tx, projectId);
      const node = await this.nodes.findInProject(projectId, nodeId, tx);
      if (!node) throw nodeInvalid(nodeId);
      const tree = await this.nodes.listByProject(projectId, tx);
      if ((childrenByParent(tree).get(node.id) ?? []).length > 0) {
        throw new DomainException(ErrorCode.PROJECT_NODE_NOT_EMPTY, 'Node has child nodes', {
          nodeId,
        });
      }
      const rollups = await this.taskReader.nodeRollups(projectId);
      if ((rollups.find((entry) => entry.nodeId === node.id)?.taskCount ?? 0) > 0) {
        throw new DomainException(ErrorCode.PROJECT_NODE_NOT_EMPTY, 'Node has tasks', { nodeId });
      }
      await this.nodes.remove(tx, node.id);
      await this.eventBus.emit(
        tx,
        PROJECT_EVENTS.NODE_DELETED,
        { projectId, nodeId: node.id, parentId: node.parentId },
        { actorId: user.id, aggregateType: 'project_node', aggregateId: node.id },
      );
    });
  }
}

/** Код папки из значений атрибутов (системный «Код», Р9 #631). */
function nodeCodeOf(customFields: Prisma.InputJsonValue | undefined): string | null {
  if (customFields === null || typeof customFields !== 'object') return null;
  const value = (customFields as Record<string, unknown>)[SYSTEM_FIELD_IDS.nodeCode];
  return typeof value === 'string' && value !== '' ? value : null;
}
