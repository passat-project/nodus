import { expect } from 'vitest';
import {
  Permission,
  type ConditionQuery,
  type GateOverridePolicy,
  type TransitionBlockReason,
  type WorkflowTransition,
} from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Общий каркас интеграционных наборов общей выборки #635: пользователи с
 * правами (руководитель проекта / сотрудник / посторонний / обладатель
 * task.override_gate), системный маршрут задач со стадиями, реестр
 * атрибутов, фабрики задач и кнопок-проб (валидатор records), уборка
 * всего созданного. Специфика набора (папки, свой тип, письма) — поверх.
 */

export interface ConditionTaskArgs {
  title: string;
  values?: Record<string, unknown>;
  parent?: string;
  node?: string | null;
  project?: string | null;
  typeId?: string;
  workflowId?: string;
  stageId?: string;
  systemState?: string;
  assignee?: string;
  creator?: string;
  confidential?: boolean;
  deleted?: boolean;
  markField?: string;
  mark?: string;
}

export interface ConditionWorld {
  fx: ChatTestFixture<'alice' | 'bob' | 'carol' | 'dave'>;
  prisma: ChatTestFixture['prisma'];
  runId: string;
  /** alice — руководитель проекта; bob — сотрудник; carol — посторонний. */
  alice: ChatUser;
  bob: ChatUser;
  carol: ChatUser;
  /** Обладатель task.override_gate без ролей в проекте. */
  dave: ChatUser;
  workflowId: string;
  taskTypeId: string;
  stage: Record<'new' | 'work' | 'paused' | 'control' | 'done' | 'cancelled', string>;
  /** id определений по ключу; cf(key) — ключ предиката `cf.<uuid>`. */
  field: Map<string, string>;
  addField(key: string, type: string, settings?: Record<string, unknown>): Promise<void>;
  cf(key: string): `cf.${string}`;
  addTask(args: ConditionTaskArgs): Promise<string>;
  /** Кнопка-переход с проверкой records на маршруте задач. */
  addRecordsProbe(args: {
    key: string;
    query: ConditionQuery;
    override?: GateOverridePolicy;
    title?: string;
    extraValidators?: unknown[];
  }): Promise<string>;
  /** Произвольный переход маршрута задач (формулы, смеси проверок). */
  addTaskTransition(args: {
    name: string;
    conditions: unknown[];
    validators: unknown[];
  }): Promise<string>;
  probeOf: Map<string, string>;
  /** Причина records кнопки-пробы для пользователя (null — пройдена). */
  reasonOf(user: ChatUser, entityId: string, key: string, path?: string): Promise<TransitionBlockReason | null>;
  /** Кнопка-переход по ключу пробы (для execute/обхода). */
  buttonOf(user: ChatUser, entityId: string, key: string, path?: string): Promise<WorkflowTransition | null>;
  /** Реестры уборки: специфичные сущности набора. */
  cleanupIds: {
    transitions: string[];
    tasks: string[];
    relations: string[];
    letters: string[];
    nodes: string[];
    nodeKinds: string[];
    projects: string[];
    fields: string[];
    processTypes: string[];
    workflows: string[];
    schemes: string[];
  };
  cleanup(): Promise<void>;
}

/** Пользовательский маршрут с отметкой «результат выдан» и итогом rejected
 *  (в системном каталоге rejected не встречается): draft → printed(выдан) →
 *  done/cancelled/rejected. Возвращает id типа/маршрута и стадии по коду. */
export async function addIssuedRoute(w: ConditionWorld): Promise<{
  typeId: string;
  workflowId: string;
  stages: Record<'draft' | 'printed' | 'done' | 'cancelled' | 'rejected', string>;
}> {
  const rows: [string, number, string, string | null, boolean][] = [
    ['draft', 10, 'backlog', null, false],
    ['printed', 20, 'active', null, true],
    ['done', 30, 'closed', 'success', false],
    ['cancelled', 40, 'closed', 'cancelled', false],
    ['rejected', 50, 'closed', 'rejected', false],
  ];
  const type = await w.prisma.processType.create({
    data: { code: `cw-t3-${w.runId}`, name: `Выборка Т3 ${w.runId}`, category: 'task' },
  });
  w.cleanupIds.processTypes.push(type.id);
  const workflow = await w.prisma.workflow.create({
    data: { name: `Маршрут Т3 ${w.runId}`, kind: 'task' },
  });
  w.cleanupIds.workflows.push(workflow.id);
  const stages = {} as Record<'draft' | 'printed' | 'done' | 'cancelled' | 'rejected', string>;
  for (const [code, order, state, outcome, issued] of rows) {
    stages[code as keyof typeof stages] = (
      await w.prisma.workflowStage.create({
        data: {
          workflowId: workflow.id,
          code,
          name: code,
          color: 'neutral',
          sortOrder: order,
          systemState: state,
          outcome,
          resultIssued: issued,
          isInitial: code === 'draft',
        },
      })
    ).id;
  }
  // Единственная схема по умолчанию (частичный unique на isDefault) — тип
  // приписывается ей, как это делает редактор типов (attachToDefaultScheme).
  const scheme = await w.prisma.workflowScheme.findFirstOrThrow({ where: { isDefault: true } });
  await w.prisma.workflowSchemeEntry.create({
    data: { schemeId: scheme.id, processTypeId: type.id, workflowId: workflow.id },
  });
  return { typeId: type.id, workflowId: workflow.id, stages };
}

export async function setupConditionWorld(): Promise<ConditionWorld> {
  const fx = await setupChatFixture(['alice', 'bob', 'carol', 'dave']);
  for (const flag of ['tasks', 'projects', 'correspondence']) {
    await fx.prisma.featureFlag.upsert({
      where: { key: flag },
      update: { enabled: true },
      create: { key: flag, enabled: true },
    });
  }
  const tokens = fx.app.get(TokenService);
  const mint = async (u: ChatUser, permissions: Permission[]): Promise<ChatUser> => ({
    ...u,
    token: await tokens.signAccessToken(
      { id: u.id, email: u.email, displayName: u.displayName, permissions },
      'integration-test-session',
    ),
  });
  const world = {
    fx,
    prisma: fx.prisma,
    runId: fx.runId,
    alice: await mint(fx.users.alice, [
      Permission.PROJECT_CREATE,
      Permission.TASK_CREATE,
      Permission.CORRESPONDENCE_REGISTER,
    ]),
    bob: await mint(fx.users.bob, [Permission.TASK_CREATE]),
    carol: await mint(fx.users.carol, [Permission.TASK_CREATE]),
    dave: await mint(fx.users.dave, [Permission.TASK_CREATE, Permission.TASK_OVERRIDE_GATE]),
    field: new Map<string, string>(),
    probeOf: new Map<string, string>(),
    cleanupIds: {
      transitions: [],
      tasks: [],
      relations: [],
      letters: [],
      nodes: [],
      nodeKinds: [],
      projects: [],
      fields: [],
      processTypes: [],
      workflows: [],
      schemes: [],
    },
  } as unknown as ConditionWorld;

  const workflow = await fx.prisma.workflow.findUniqueOrThrow({
    where: { code: 'task.default' },
  });
  world.workflowId = workflow.id;
  world.taskTypeId = (
    await fx.prisma.processType.findUniqueOrThrow({ where: { code: 'task' } })
  ).id;
  const stage = {} as ConditionWorld['stage'];
  for (const [key, code] of [
    ['new', 'new'],
    ['work', 'in_progress'],
    ['paused', 'paused'],
    ['control', 'on_control'],
    ['done', 'done'],
    ['cancelled', 'cancelled'],
  ] as const) {
    stage[key] = (
      await fx.prisma.workflowStage.findFirstOrThrow({
        where: { workflowId: world.workflowId, code },
      })
    ).id;
  }
  world.stage = stage;

  world.addField = async (key, type, settings = {}) => {
    const number =
      (await fx.prisma.fieldDefinition.aggregate({ _max: { number: true } }))._max.number ?? 0;
    const id = crypto.randomUUID();
    await fx.prisma.fieldDefinition.create({
      data: {
        id,
        number: number + 1,
        type,
        name: `Выборка ${key} ${fx.runId}`,
        settings: settings as never,
      },
    });
    world.cleanupIds.fields.push(id);
    world.field.set(key, id);
  };
  world.cf = (key: string) => `cf.${world.field.get(key)!}` as `cf.${string}`;

  world.addTask = async (args) => {
    const values: Record<string, unknown> = { ...(args.values ?? {}) };
    if (args.mark !== undefined && args.markField !== undefined) {
      values[world.field.get(args.markField) ?? ''] = args.mark;
    }
    const row = await fx.prisma.task.create({
      data: {
        title: `${args.title} ${fx.runId}`,
        typeId: args.typeId ?? world.taskTypeId,
        workflowId: args.workflowId ?? world.workflowId,
        stageId: args.stageId ?? stage.new,
        systemState: args.systemState ?? 'backlog',
        stageOrder: `cw${fx.runId}${world.cleanupIds.tasks.length}`,
        creatorId: args.creator ?? world.alice.id,
        assigneeId: args.assignee ?? world.bob.id,
        parentId: args.parent ?? null,
        projectId: args.project === undefined ? null : args.project,
        nodeId: args.node ?? null,
        confidential: args.confidential === true,
        deletedAt: args.deleted === true ? new Date() : null,
        customFields: values as never,
      },
    });
    world.cleanupIds.tasks.push(row.id);
    return row.id;
  };

  world.addTaskTransition = async ({ name, conditions, validators }) => {
    const row = await fx.prisma.workflowTransition.create({
      data: {
        workflowId: world.workflowId,
        code: null,
        name: `${name} ${fx.runId}`,
        fromStageId: stage.new,
        toStageId: stage.work,
        display: 'button',
        intent: 'action',
        sortOrder: 960 + world.cleanupIds.transitions.length,
        rules: { conditions, validators, postFunctions: [] } as never,
        form: { enabled: false, sections: [] } as never,
      },
    });
    world.cleanupIds.transitions.push(row.id);
    return row.id;
  };

  world.addRecordsProbe = async ({ key, query, override, title, extraValidators }) => {
    const id = await world.addTaskTransition({
      name: `Проба ${key}`,
      conditions: [],
      validators: [
        {
          kind: 'records',
          title: title ?? `Проба ${key}`,
          query,
          override: override ?? { mode: 'default', extraUserIds: [] },
        },
        ...(extraValidators ?? []),
      ],
    });
    world.probeOf.set(key, id);
    return id;
  };

  world.buttonOf = async (user, entityId, key, path = 'tasks') => {
    const res = await fx.api(user, 'GET', `/${path}/${entityId}/transitions`);
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as WorkflowTransition[]).find((t) => t.id === world.probeOf.get(key)) ?? null;
  };

  world.reasonOf = async (user, entityId, key, path = 'tasks') => {
    const button = await world.buttonOf(user, entityId, key, path);
    return button?.blockedBy.find((r) => r.kind === 'records') ?? null;
  };

  world.cleanup = async () => {
    const ids = world.cleanupIds;
    const prisma = fx.prisma;
    if (ids.relations.length > 0) {
      await prisma.taskRelation.deleteMany({ where: { id: { in: ids.relations } } });
    }
    if (ids.transitions.length > 0) {
      await prisma.workflowTransition.deleteMany({ where: { id: { in: ids.transitions } } });
    }
    if (ids.tasks.length > 0) {
      await prisma.task.updateMany({
        where: { parentId: { in: ids.tasks } },
        data: { parentId: null },
      });
      await prisma.task.deleteMany({ where: { id: { in: ids.tasks } } });
    }
    if (ids.letters.length > 0) {
      await prisma.letter.deleteMany({ where: { id: { in: ids.letters } } });
    }
    if (ids.nodes.length > 0) {
      await prisma.projectNode.deleteMany({ where: { id: { in: ids.nodes } } });
    }
    if (ids.projects.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: ids.projects } } });
    }
    if (ids.processTypes.length > 0) {
      await prisma.workflowSchemeEntry.deleteMany({
        where: { processTypeId: { in: ids.processTypes } },
      });
    }
    if (ids.schemes.length > 0) {
      await prisma.workflowScheme.deleteMany({ where: { id: { in: ids.schemes } } });
    }
    if (ids.workflows.length > 0) {
      await prisma.workflowStage.deleteMany({ where: { workflowId: { in: ids.workflows } } });
      await prisma.workflow.deleteMany({ where: { id: { in: ids.workflows } } });
    }
    if (ids.processTypes.length > 0) {
      await prisma.processType.deleteMany({ where: { id: { in: ids.processTypes } } });
    }
    if (ids.nodeKinds.length > 0) {
      await prisma.nodeKind.deleteMany({ where: { id: { in: ids.nodeKinds } } });
    }
    await prisma.event.deleteMany({
      where: { aggregateType: 'field_definition', aggregateId: { in: ids.fields } },
    });
    if (ids.fields.length > 0) {
      await prisma.fieldDefinition.deleteMany({ where: { id: { in: ids.fields } } });
    }
    await fx.cleanup();
  };

  return world;
}
