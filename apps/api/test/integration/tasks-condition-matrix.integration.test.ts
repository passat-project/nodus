import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Permission,
  type CustomFieldType,
  type TransitionBlockReason,
  type WorkflowTransition,
} from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';
import { CUR_1, MATRIX } from './tasks-condition-matrix.data.js';

/**
 * Матрица «оператор × тип атрибута» общей выборки #635 на реальном движке:
 * для каждой ВАЛИДНОЙ пары из CONDITION_FIELD_OPS_BY_TYPE — совпадающее
 * значение (условие истинно, кнопка видна) и несовпадающее (ложь, кнопка
 * спрятана). Субъект self + квантор all: запись-хост сама является строкой
 * выборки, предикат field решает видимость кнопки. Грани обязательны:
 * ключ отсутствует в JSONB, значение null, массивы (пересечение in_any),
 * деньги {amount, currencyId} и чужая валюта, даты ISO, contains — подстрока
 * и регистр, явный null у предиката eq/ne («пусто»).
 */

describe.skipIf(!process.env.DATABASE_URL)('общая выборка (#635): матрица оператор×тип', () => {
  let fx: ChatTestFixture<'alice' | 'bob'>;
  let bob: ChatUser;
  let workflowId = '';
  let stageNew = '';
  let stageWork = '';
  const transitionIds: string[] = [];
  const taskIds: string[] = [];
  const definitionIds: string[] = [];
  /** (тип, оператор#порядковый-номер, вариант) → переход виден. */
  const visibleByHost = new Map<string, ReadonlySet<string>>();
  const transitionOf = new Map<string, string>();
  const hostOf = new Map<string, string>();
  let beaconId = '';
  const validatorIds: string[] = [];
  let validatorHostMatch = '';
  let validatorHostMiss = '';

  beforeAll(async () => {
    fx = await setupChatFixture(['alice', 'bob']);
    await fx.prisma.featureFlag.upsert({
      where: { key: 'tasks' },
      update: { enabled: true },
      create: { key: 'tasks', enabled: true },
    });
    const tokens = fx.app.get(TokenService);
    bob = {
      ...fx.users.bob,
      token: await tokens.signAccessToken(
        {
          id: fx.users.bob.id,
          email: fx.users.bob.email,
          displayName: fx.users.bob.displayName,
          permissions: [Permission.TASK_CREATE],
        },
        'integration-test-session',
      ),
    };

    const workflow = await fx.prisma.workflow.findUniqueOrThrow({
      where: { code: 'task.default' },
    });
    workflowId = workflow.id;
    stageNew = (
      await fx.prisma.workflowStage.findFirstOrThrow({
        where: { workflowId, code: 'new', archivedAt: null },
      })
    ).id;
    stageWork = (
      await fx.prisma.workflowStage.findFirstOrThrow({
        where: { workflowId, code: 'in_progress', archivedAt: null },
      })
    ).id;

    // Определения всех 19 типов (значения пишутся напрямую в JSONB задач).
    let fieldNumber =
      (await fx.prisma.fieldDefinition.aggregate({ _max: { number: true } }))._max.number ?? 0;
    const fieldIdOf = new Map<CustomFieldType, string>();
    for (const entry of MATRIX) {
      fieldNumber += 1;
      const id = crypto.randomUUID();
      const settings: Record<string, unknown> =
        entry.type === 'money'
          ? { currencyId: CUR_1 }
          : entry.type === 'enum' || entry.type === 'multienum'
            ? { dictionaryId: crypto.randomUUID() }
            : entry.type === 'number'
              ? { precision: 0 }
              : {};
      await fx.prisma.fieldDefinition.create({
        data: {
          id,
          number: fieldNumber,
          type: entry.type,
          name: `Матрица ${entry.type} ${fx.runId}`,
          settings: settings as never,
          createdById: fx.users.alice.id,
        },
      });
      definitionIds.push(id);
      fieldIdOf.set(entry.type, id);
    }

    const addTransition = async (
      key: string,
      conditions: unknown[],
      validators: unknown[] = [],
    ): Promise<string> => {
      const row = await fx.prisma.workflowTransition.create({
        data: {
          workflowId,
          code: null,
          name: `Матрица ${key} ${fx.runId}`,
          fromStageId: stageNew,
          toStageId: stageWork,
          display: 'button',
          intent: 'action',
          sortOrder: 900 + transitionIds.length,
          rules: { conditions, validators, postFunctions: [] } as never,
          form: { enabled: false, sections: [] } as never,
        },
      });
      transitionIds.push(row.id);
      transitionOf.set(key, row.id);
      return row.id;
    };

    // Кнопка-маяк: пустая выборка self без предикатов — всегда видна.
    beaconId = await addTransition('beacon', [
      { kind: 'records', query: { subject: { kind: 'self' }, where: [], quantifier: 'all' } },
    ]);

    // Переходы матрицы: условие records (прячет кнопку) с одним предикатом.
    const opCount = new Map<string, number>();
    for (const entry of MATRIX) {
      const field = `cf.${fieldIdOf.get(entry.type)}`;
      for (const opCase of entry.ops) {
        const seq = (opCount.get(`${entry.type}:${opCase.op}`) ?? 0) + 1;
        opCount.set(`${entry.type}:${opCase.op}`, seq);
        const key = `${entry.type}:${opCase.op}#${seq}`;
        await addTransition(key, [
          {
            kind: 'records',
            query: {
              subject: { kind: 'self' },
              where: [
                {
                  kind: 'field',
                  field,
                  op: opCase.op,
                  ...(opCase.op === 'filled' || opCase.op === 'not_filled'
                    ? {}
                    : { value: opCase.value ?? null }),
                },
              ],
              quantifier: 'all',
            },
          },
        ]);
      }
    }

    // Точечные валидаторы (проверка «не пускает, причина») на number eq.
    const numberField = `cf.${fieldIdOf.get('number')}`;
    for (const [key, value] of [
      ['validator:match', 5],
      ['validator:miss', 7],
    ] as const) {
      const row = await fx.prisma.workflowTransition.create({
        data: {
          workflowId,
          code: null,
          name: `Матрица ${key} ${fx.runId}`,
          fromStageId: stageNew,
          toStageId: stageWork,
          display: 'button',
          intent: 'action',
          sortOrder: 900 + transitionIds.length,
          rules: {
            conditions: [],
            validators: [
              {
                kind: 'records',
                title: 'Число не равно пяти',
                query: {
                  subject: { kind: 'self' },
                  where: [
                    { kind: 'field', field: numberField, op: 'eq', value: value as number },
                  ],
                  quantifier: 'all',
                },
                override: { mode: 'default', extraUserIds: [] },
              },
            ],
            postFunctions: [],
          } as never,
          form: { enabled: false, sections: [] } as never,
        },
      });
      validatorIds.push(row.id);
      transitionOf.set(key, row.id);
    }

    // Хосты: задача на «Ожидает» со значением варианта в JSONB.
    const addHost = async (type: CustomFieldType, variant: string, value: unknown) => {
      const fieldId = fieldIdOf.get(type)!;
      const values: Record<string, unknown> = {};
      if (value !== undefined) values[fieldId] = value;
      const row = await fx.prisma.task.create({
        data: {
          title: `Матрица ${type}/${variant} ${fx.runId}`,
          typeId: (
            await fx.prisma.processType.findUniqueOrThrow({ where: { code: 'task' } })
          ).id,
          workflowId,
          stageId: stageNew,
          systemState: 'backlog',
          stageOrder: `cm${fx.runId}${taskIds.length}`,
          creatorId: bob.id,
          assigneeId: bob.id,
          customFields: values as never,
        },
      });
      taskIds.push(row.id);
      hostOf.set(`${type}:${variant}`, row.id);
      return row.id;
    };

    for (const entry of MATRIX) {
      for (const [variant, value] of Object.entries(entry.variants)) {
        await addHost(entry.type, variant, value);
      }
    }
    // Хосты для валидаторов: number = 5 (совпадает) и number = 9 (мимо).
    validatorHostMatch = await addHost('number', 'validatorMatch', 5);
    validatorHostMiss = await addHost('number', 'validatorMiss', 9);

    // Один GET на хост: множество видимых кнопок.
    for (const host of hostOf.values()) {
      const res = await fx.api(bob, 'GET', `/tasks/${host}/transitions`);
      expect(res.status, await res.clone().text()).toBe(200);
      const list = (await res.json()) as WorkflowTransition[];
      visibleByHost.set(host, new Set(list.map((t) => t.id)));
    }
  }, 420_000);

  afterAll(async () => {
    if (fx) {
      if (transitionIds.length > 0 || validatorIds.length > 0) {
        await fx.prisma.workflowTransition.deleteMany({
          where: { id: { in: [...transitionIds, ...validatorIds] } },
        });
      }
      if (taskIds.length > 0) {
        await fx.prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      }
      await fx.prisma.event.deleteMany({
        where: { aggregateType: 'field_definition', aggregateId: { in: definitionIds } },
      });
      if (definitionIds.length > 0) {
        await fx.prisma.fieldDefinition.deleteMany({ where: { id: { in: definitionIds } } });
      }
    }
    await fx?.cleanup();
  });

  it('маяк: кнопка с пустой выборкой self видна всегда (механика списка)', () => {
    const anyHost = hostOf.values().next().value!;
    expect(visibleByHost.get(anyHost)!.has(beaconId)).toBe(true);
  });

  const cells = MATRIX.flatMap((entry) => {
    const variantKeys = Object.keys(entry.variants);
    return entry.ops.flatMap((opCase, index) => {
      const seq =
        entry.ops.slice(0, index + 1).filter((o) => o.op === opCase.op).length;
      const key = `${entry.type}:${opCase.op}#${seq}`;
      // Таблица должна покрывать все варианты — цельность данных теста.
      for (const variant of variantKeys) {
        expect(opCase.expect, `${key} × ${variant}`).toHaveProperty(variant);
      }
      return variantKeys.map((variant) => ({
        type: entry.type,
        op: opCase.op,
        seq,
        variant,
        expected: opCase.expect[variant]!,
      }));
    });
  });

  it.each(cells)(
    '$type × $op#$seq на варианте $variant → кнопка $expected',
    ({ type, op, seq, variant, expected }) => {
      const host = hostOf.get(`${type}:${variant}`)!;
      const transition = transitionOf.get(`${type}:${op}#${seq}`)!;
      expect(host, `хост ${type}:${variant}`).toBeDefined();
      expect(transition, `переход ${type}:${op}#${seq}`).toBeDefined();
      expect(visibleByHost.get(host)!.has(transition)).toBe(expected);
    },
  );

  it('валидатор-путь матрицы: number eq 5 блокирует с причиной, eq 7 — нет', async () => {
    // Совпадение (5 == 5): проверка пройдена, причины records нет.
    const okList = (await (
      await fx.api(bob, 'GET', `/tasks/${validatorHostMatch}/transitions`)
    ).json()) as WorkflowTransition[];
    const ok = okList.find((t) => t.id === transitionOf.get('validator:match'))!
      .blockedBy as TransitionBlockReason[];
    expect(ok.some((r) => r.kind === 'records')).toBe(false);
    // Мимо (9 ≠ 7): причина с подписью настройщика.
    const blockedList = (await (
      await fx.api(bob, 'GET', `/tasks/${validatorHostMiss}/transitions`)
    ).json()) as WorkflowTransition[];
    const blocked = blockedList.find((t) => t.id === transitionOf.get('validator:miss'))!
      .blockedBy as TransitionBlockReason[];
    const reason = blocked.find((r) => r.kind === 'records')!;
    expect(reason).toBeDefined();
    expect(reason.title).toBe('Число не равно пяти');
    expect(reason.records).toHaveLength(1);
    expect(reason.records![0]).toMatchObject({
      id: validatorHostMiss,
      entityKind: 'task',
    });
  });
});
