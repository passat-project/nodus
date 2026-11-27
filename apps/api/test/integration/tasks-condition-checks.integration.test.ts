import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  ErrorCode,
  Permission,
  type ConditionQuery,
} from '@nodus/contracts';

import { setupConditionWorld, type ConditionWorld } from './tasks-condition-world.js';

/**
 * Причины, обход и формулы общей выборки #635 на реальном движке: причина —
 * до 5 видимых записей и счётчик невидимых (конфиденциальная подзадача в
 * кванторе учитывается, в причине не называется); обход — default
 * (руководство/право/доп. сотрудники/роль), forbidden (никто), а политика
 * спрашивается ТОЛЬКО у непройденных проверок (пройденная не даёт прав);
 * формула — истина/ложь/ошибка вычисления (ложь); письмо-хост — тот же язык.
 */
describe.skipIf(!process.env.DATABASE_URL)('общая выборка (#635): причины, обход, формулы', () => {
  let w: ConditionWorld;
  let projectId = '';
  let letterId = '';
  let letterWorkflowId = '';
  let letterStageNew = '';
  let letterStageNext = '';
  let reasonHost = '';
  let mixHost = '';
  const hosts: Record<string, string> = {};

  beforeAll(async () => {
    w = await setupConditionWorld();
    const prisma = w.prisma;
    const runId = w.runId;
    await w.addField('taskMark', 'text');
    await w.addField('letterMark', 'text');

    // Проект: alice — руководитель, bob — участник (роль в проекте), carol — мимо.
    const projectTypes = (await (
      await w.fx.api(w.alice, 'GET', '/projects/types')
    ).json()) as { id: string }[];
    const projectRes = await w.fx.api(w.alice, 'POST', '/projects', {
      body: {
        typeId: projectTypes[0]!.id,
        name: `Выборка проверки ${runId}`,
        code: `Проверки ${runId}`,
        managerId: w.alice.id,
      },
      key: `ck-proj-${runId}`,
    });
    expect(projectRes.status, await projectRes.clone().text()).toBe(201);
    projectId = ((await projectRes.json()) as { id: string }).id;
    w.cleanupIds.projects.push(projectId);
    await prisma.projectParticipant.create({
      data: { projectId, userId: w.bob.id, source: 'member' },
    });

    // Письмо-хост с полем и проектом.
    const letterType = await prisma.processType.findUniqueOrThrow({
      where: { code: 'letter-incoming' },
    });
    const letterWorkflow = await prisma.workflow.findUniqueOrThrow({
      where: { code: 'letter.incoming' },
    });
    letterWorkflowId = letterWorkflow.id;
    letterStageNew = (
      await prisma.workflowStage.findFirstOrThrow({
        where: { workflowId: letterWorkflow.id, code: 'new' },
      })
    ).id;
    letterStageNext = (
      await prisma.workflowStage.findFirstOrThrow({
        where: { workflowId: letterWorkflow.id, code: 'on_resolution' },
      })
    ).id;
    const letter = await prisma.letter.create({
      data: {
        typeId: letterType.id,
        workflowId: letterWorkflow.id,
        stageId: letterStageNew,
        systemState: 'backlog',
        direction: 'incoming',
        subject: `Проверки письмо ${runId}`,
        createdBy: w.alice.id,
        projectId,
        customFields: { [w.field.get('letterMark')!]: 'ВХ-1' } as never,
      },
    });
    letterId = letter.id;
    w.cleanupIds.letters.push(letterId);

    const t = (args: Parameters<ConditionWorld['addTask']>[0]) =>
      w.addTask({ markField: 'taskMark', project: projectId, ...args });

    // Причина: 7 подзадач-нарушителей (все видимые) → 5 записей + 0 скрытых.
    reasonHost = await t({ title: 'Причины' });
    for (let i = 1; i <= 7; i += 1) {
      await t({ title: `нарушитель ${i}`, mark: 'Z', parent: reasonHost });
    }
    // Квантор честный: одна видимая проходит, конфиденциальная — нет; причина
    // не называет невидимую, но «все» от неё ложится.
    mixHost = await t({ title: 'Смешанная' });
    await t({ title: 'видимая проходит', mark: 'X', parent: mixHost });
    await t({
      title: 'скрытая не проходит',
      mark: 'Y',
      parent: mixHost,
      assignee: w.carol.id,
      confidential: true,
    });

    // Хосты обхода: у каждого открытая подзадача (проверка «все выполнены» ложна).
    const overrideHost = async (key: string, assignee: string, creator?: string): Promise<string> => {
      const id = await t({ title: `Обход ${key}`, assignee, creator });
      await t({ title: `открытая подзадача ${key}`, mark: 'OPEN', parent: id });
      hosts[key] = id;
      return id;
    };
    await overrideHost('extra', w.bob.id, w.carol.id);
    await overrideHost('role', w.bob.id, w.carol.id);
    await overrideHost('right', w.dave.id);
    await overrideHost('esc', w.carol.id);
    await overrideHost('strict', w.bob.id);
    await overrideHost('manager', w.bob.id);
    await overrideHost('formula', w.bob.id);

    const markField = w.cf('taskMark');
    const q = (
      subject: ConditionQuery['subject'],
      where: ConditionQuery['where'] = [],
      quantifier: ConditionQuery['quantifier'] = 'none',
    ): ConditionQuery => ({ subject, where, quantifier });
    // Проверка «все подзадачи с меткой DONE»: открытая (метка OPEN) роняет.
    const failQuery = q(
      { kind: 'subtasks' },
      [{ kind: 'field', field: markField, op: 'eq', value: 'DONE' }],
      'all',
    );
    // Всегда истинная проверка (self без условий, «все»).
    const passQuery = q({ kind: 'self' }, [], 'all');

    // Причины.
    await w.addRecordsProbe({
      key: 'reason:7',
      title: 'Не принято: задания смежников',
      query: q({ kind: 'subtasks' }, [{ kind: 'field', field: markField, op: 'eq', value: 'NOPE' }], 'all'),
    });
    await w.addRecordsProbe({
      key: 'reason:mix',
      title: 'Не принято: скрытая',
      query: q({ kind: 'subtasks' }, [{ kind: 'field', field: markField, op: 'eq', value: 'X' }], 'all'),
    });

    // Обход: default/extraUserIds/projectRole/право + смеси (пройденная
    // проверка не даёт прав своей политикой — регрессия #635).
    await w.addTaskTransition({
      name: 'Обход доп.сотрудник',
      conditions: [{ kind: 'role_in', roles: ['assignee', 'creator'] }],
      validators: [
        {
          kind: 'records',
          title: 'Не принято',
          query: failQuery,
          override: { mode: 'default', extraUserIds: [w.bob.id] },
        },
      ],
    }).then((id) => w.probeOf.set('ov:extra', id));
    await w.addTaskTransition({
      name: 'Обход роль',
      conditions: [{ kind: 'role_in', roles: ['assignee', 'creator'] }],
      validators: [
        {
          kind: 'records',
          title: 'Не принято',
          query: failQuery,
          override: { mode: 'default', extraUserIds: [], projectRole: 'participant' },
        },
      ],
    }).then((id) => w.probeOf.set('ov:role', id));
    await w.addTaskTransition({
      name: 'Обход право',
      conditions: [{ kind: 'role_in', roles: ['assignee', 'creator'] }],
      validators: [
        {
          kind: 'records',
          title: 'Не принято',
          query: failQuery,
          override: { mode: 'default', extraUserIds: [] },
        },
      ],
    }).then((id) => w.probeOf.set('ov:right', id));
    await w.addTaskTransition({
      name: 'Эскалация через пройденную',
      conditions: [{ kind: 'role_in', roles: ['assignee', 'creator'] }],
      validators: [
        {
          kind: 'records',
          title: 'Не принято',
          query: failQuery,
          override: { mode: 'default', extraUserIds: [] },
        },
        {
          kind: 'records',
          title: 'Всегда ок',
          query: passQuery,
          override: { mode: 'default', extraUserIds: [w.carol.id] },
        },
      ],
    }).then((id) => w.probeOf.set('ov:esc', id));
    await w.addTaskTransition({
      name: 'Запрет через пройденную',
      conditions: [{ kind: 'role_in', roles: ['assignee', 'creator'] }],
      validators: [
        {
          kind: 'records',
          title: 'Не принято',
          query: failQuery,
          override: { mode: 'default', extraUserIds: [] },
        },
        {
          kind: 'records',
          title: 'Всегда ок',
          query: passQuery,
          override: { mode: 'forbidden', extraUserIds: [] },
        },
      ],
    }).then((id) => w.probeOf.set('ov:strict', id));
    await w.addTaskTransition({
      name: 'Обход руководитель',
      conditions: [{ kind: 'role_in', roles: ['assignee', 'creator'] }],
      validators: [
        {
          kind: 'records',
          title: 'Не принято',
          query: failQuery,
          override: { mode: 'default', extraUserIds: [] },
        },
      ],
    }).then((id) => w.probeOf.set('ov:manager', id));

    // Формулы: истина / ложь / ошибка вычисления.
    for (const [key, formula] of [
      ['formula:true', { kind: 'literal', value: true }],
      ['formula:false', { kind: 'literal', value: false }],
      ['formula:error', { kind: 'op', op: 'div', args: [{ kind: 'literal', value: 1 }, { kind: 'literal', value: 0 }] }],
    ] as const) {
      const id = await w.addTaskTransition({
        name: `Формула ${key}`,
        conditions: [{ kind: 'role_in', roles: ['assignee', 'creator'] }],
        validators: [
          {
            kind: 'formula',
            title: `Формула ${key}`,
            formula,
            override: { mode: 'default', extraUserIds: [] },
          },
        ],
      });
      w.probeOf.set(key, id);
    }

    // Письмо-хост: своя запись с полем, проект письма, связи (их у письма нет).
    const letterProbe = async (key: string, query: ConditionQuery): Promise<void> => {
      const row = await prisma.workflowTransition.create({
        data: {
          workflowId: letterWorkflowId,
          code: null,
          name: `Проверки ${key} ${runId}`,
          fromStageId: letterStageNew,
          toStageId: letterStageNext,
          display: 'button',
          intent: 'action',
          sortOrder: 970 + w.cleanupIds.transitions.length,
          rules: {
            conditions: [
              { kind: 'permission', permission: Permission.CORRESPONDENCE_REGISTER },
            ],
            validators: [
              {
                kind: 'records',
                title: `Проверки ${key}`,
                query,
                override: { mode: 'default', extraUserIds: [] },
              },
            ],
            postFunctions: [],
          } as never,
          form: { enabled: false, sections: [] } as never,
        },
      });
      w.cleanupIds.transitions.push(row.id);
      w.probeOf.set(key, row.id);
    };
    await letterProbe('letter:self', q({ kind: 'self' }, [
      { kind: 'field', field: w.cf('letterMark'), op: 'eq', value: 'ВХ-1' },
    ]));
    await letterProbe('letter:project', q({ kind: 'project' }));
    await letterProbe('letter:relations', q({ kind: 'relations', relation: 'relates', direction: 'both' }, [], 'any'));
  }, 240_000);

  afterAll(async () => {
    await w?.cleanup();
  });

  function execute(
    user: ConditionWorld['bob'],
    taskId: string,
    key: string,
    body: Record<string, unknown>,
  ) {
    return w.fx.api(user, 'POST', `/tasks/${taskId}/transitions/${w.probeOf.get(key)}`, {
      body: body as never,
      key: `ck-exec-${key}-${crypto.randomUUID()}`,
    });
  }

  it('причина: 7 видимых нарушителей — 5 записей, скрытых 0', async () => {
    const reason = await w.reasonOf(w.bob, reasonHost, 'reason:7');
    expect(reason?.title).toBe('Не принято: задания смежников');
    expect(reason?.records).toHaveLength(5);
    expect(reason?.records?.every((r) => r.name.startsWith('нарушитель'))).toBe(true);
    expect(reason?.hiddenCount).toBe(0);
  });

  it('квантор честный: конфиденциальная подзадача не даёт «всем» сойтись, в причине не называется', async () => {
    // Видимая подзадача проходит условие, скрытая — нет: «все» ложны,
    // причина не называет невидимую запись, но счётчик её держит.
    const reason = await w.reasonOf(w.bob, mixHost, 'reason:mix');
    expect(reason).not.toBeNull();
    expect(reason?.records).toEqual([]);
    expect(reason?.hiddenCount).toBe(1);
  });

  it('обход default: доп. сотрудник из настройки проходит с причиной', async () => {
    // Посторонний (без политики) — нет; проверяем ДО успешного обхода:
    //успешный переход уводит запись со стадии кнопки.
    const denied = await execute(w.carol, hosts.extra!, 'ov:extra', {
      override: true,
      reason: 'Очень надо',
    });
    expect(denied.status).toBe(403);
    const ok = await execute(w.bob, hosts.extra!, 'ov:extra', {
      override: true,
      reason: 'Заказчик требует срочно',
    });
    expect(ok.status).toBe(200);
  });

  it('обход default: роль в проекте (участник) проходит; посторонний нет', async () => {
    const denied = await execute(w.carol, hosts.role!, 'ov:role', {
      override: true,
      reason: 'Очень надо',
    });
    expect(denied.status).toBe(403);
    const ok = await execute(w.bob, hosts.role!, 'ov:role', {
      override: true,
      reason: 'По участию',
    });
    expect(ok.status).toBe(200);
  });

  it('обход default: обладатель task.override_gate проходит без ролей', async () => {
    const ok = await execute(w.dave, hosts.right!, 'ov:right', {
      override: true,
      reason: 'Право обхода',
    });
    expect(ok.status).toBe(200);
  });

  it('обход default: руководитель проекта проходит; причина обязательна', async () => {
    const noReason = await execute(w.alice, hosts.manager!, 'ov:manager', {
      override: true,
    });
    expect(noReason.status).toBe(400);
    expect(apiErrorResponseSchema.parse(await noReason.json()).code).toBe(
      ErrorCode.WORKFLOW_OVERRIDE_REASON_REQUIRED,
    );
    const ok = await execute(w.alice, hosts.manager!, 'ov:manager', {
      override: true,
      reason: 'Руководитель решил',
    });
    expect(ok.status).toBe(200);
    const event = await w.prisma.event.findFirstOrThrow({
      where: { type: 'task.stage_changed', aggregateId: hosts.manager! },
      orderBy: { createdAt: 'desc' },
    });
    const payload = event.payload as { reason?: string; overriddenGates?: string[] };
    expect(payload.reason).toBe('Руководитель решил');
    expect(payload.overriddenGates).toContain('records');
  });

  it('регрессия обхода: ПРОЙДЕННАЯ проверка не открывает обход своей политикой', async () => {
    // Вторая (проходящая) проверка вписала carol в доп. сотрудники —
    // обход непройденной первой ей не положен.
    const denied = await execute(w.carol, hosts.esc!, 'ov:esc', {
      override: true,
      reason: 'Пролезть',
    });
    expect(denied.status).toBe(403);
  });

  it('регрессия обхода: forbidden ПРОЙДЕННОЙ проверки не запрещает обход непройденной', async () => {
    // Руководитель проекта проходит непройденную default-проверку, хотя
    // рядом стоит проходящая с запретом обхода.
    const ok = await execute(w.alice, hosts.strict!, 'ov:strict', {
      override: true,
      reason: 'Запрет пройденной не действует',
    });
    expect(ok.status).toBe(200);
  });

  it('формула: истина не блокирует; ложь и ошибка вычисления — блокируют', async () => {
    const okButton = await w.buttonOf(w.bob, hosts.formula!, 'formula:true');
    expect(okButton?.blockedBy ?? []).toEqual([]);
    const falseButton = await w.buttonOf(w.bob, hosts.formula!, 'formula:false');
    expect(falseButton?.blockedBy.find((r) => r.kind === 'formula')).toMatchObject({
      kind: 'formula',
      title: 'Формула formula:false',
    });
    const errorButton = await w.buttonOf(w.bob, hosts.formula!, 'formula:error');
    expect(errorButton?.blockedBy.find((r) => r.kind === 'formula')).toMatchObject({
      kind: 'formula',
      title: 'Формула formula:error',
    });
  });

  it('письмо: своя запись с полем, проект письма; связей у письма нет (пусто)', async () => {
    const selfReason = await w.reasonOf(w.alice, letterId, 'letter:self', 'letters');
    expect(selfReason?.records?.map((r) => r.id)).toEqual([letterId]);
    expect(selfReason?.records?.[0]?.entityKind).toBe('letter');
    const projectReason = await w.reasonOf(w.alice, letterId, 'letter:project', 'letters');
    expect(projectReason?.records?.map((r) => r.id)).toEqual([projectId]);
    // Субъект письму разрешён картой категории, но связи писем пока пусты:
    // «хотя бы одна» на пустой выборке — ложь (кнопка держит, записей нет).
    const relationsButton = await w.buttonOf(w.alice, letterId, 'letter:relations', 'letters');
    const relationsReason = relationsButton?.blockedBy.find((r) => r.kind === 'records');
    expect(relationsReason).toMatchObject({ kind: 'records', records: [], hiddenCount: 0 });
  });
});
