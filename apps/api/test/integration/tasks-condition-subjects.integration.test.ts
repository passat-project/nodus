/* eslint-disable nodus-internal/max-lines-warn -- субъекты/кванторы/предикаты выборки (#635): таблица проб на живом стеке */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConditionQuery } from '@nodus/contracts';

import {
  addIssuedRoute,
  setupConditionWorld,
  type ConditionWorld,
} from './tasks-condition-world.js';

/**
 * Субъекты, кванторы и предикты общей выборки #635 на реальном движке: все
 * 10 субъектов задачи, кванторы all/any/none на 0/1/2 подходящих, предикаты
 * type_is/stage_is/system_state/outcome/result_issued (отметка действует
 * «с этого статуса и дальше»; без отметок «выдана» = закрыта успешно).
 * Проба — валидатор кнопки: `none` без предикатов даёт причину со всей
 * выборкой (≤5 + счётчик скрытых), null — проверка пройдена.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'общая выборка (#635): субъекты, кванторы, предикаты',
  () => {
    let w: ConditionWorld;
    let t3TypeId = '';
    let w3WorkflowId = '';
    let projectId = '';
    let kindFolder = '';
    let kindVolume = '';
    let folderKzh = '';
    let folderVolume = '';
    let folderNested = '';
    let host = '';
    let hostParent = '';
    let siblingConfidential = '';
    let volumeTask = '';
    let nestedTask = '';
    let noProjectHost = '';
    let letterId = '';
    let relA = '';
    let relB = '';
    const w3Stage: Record<string, string> = {};
    const quantHost: Record<'q0' | 'q1' | 'q2', string> = {} as never;

    beforeAll(async () => {
      w = await setupConditionWorld();
      const prisma = w.prisma;
      const runId = w.runId;

      const issuedRoute = await addIssuedRoute(w);
      t3TypeId = issuedRoute.typeId;
      w3WorkflowId = issuedRoute.workflowId;
      Object.assign(w3Stage, issuedRoute.stages);

      for (const [key, type] of [
        ['taskMark', 'text'],
        ['folderMark', 'text'],
        ['projectMark', 'text'],
        ['refTask', 'task'],
        ['refLetter', 'letter'],
        ['refProject', 'project'],
        ['refNode', 'node'],
        ['refUser', 'user'],
        ['refDept', 'department'],
        ['refCP', 'counterparty'],
      ] as const) {
        await w.addField(key, type);
      }

      // Проект (руководитель alice) с полем.
      const projectTypes = (await (await w.fx.api(w.alice, 'GET', '/projects/types')).json()) as {
        id: string;
      }[];
      const projectRes = await w.fx.api(w.alice, 'POST', '/projects', {
        body: {
          typeId: projectTypes[0]!.id,
          name: `Выборка субъекты ${runId}`,
          code: `Субъекты ${runId}`,
          managerId: w.alice.id,
        },
        key: `cs-proj-${runId}`,
      });
      expect(projectRes.status, await projectRes.clone().text()).toBe(201);
      projectId = ((await projectRes.json()) as { id: string }).id;
      w.cleanupIds.projects.push(projectId);
      await prisma.project.update({
        where: { id: projectId },
        data: { customFields: { [w.field.get('projectMark')!]: 'СД' } as never },
      });

      // Письмо-цель для ссылки ref_field (реальная запись движка писем).
      const letterType = await prisma.processType.findUniqueOrThrow({
        where: { code: 'letter-incoming' },
      });
      const letterWorkflow = await prisma.workflow.findUniqueOrThrow({
        where: { code: 'letter.incoming' },
      });
      const letter = await prisma.letter.create({
        data: {
          typeId: letterType.id,
          workflowId: letterWorkflow.id,
          stageId: (
            await prisma.workflowStage.findFirstOrThrow({
              where: { workflowId: letterWorkflow.id, code: 'new' },
            })
          ).id,
          systemState: 'backlog',
          direction: 'incoming',
          subject: `Выборка письмо ${runId}`,
          createdBy: w.alice.id,
          projectId,
        },
      });
      letterId = letter.id;
      w.cleanupIds.letters.push(letter.id);

      // Виды папок и структура: раздел КЖ (с маркой), том, вложенный раздел.
      for (const [slot, name, color] of [
        ['kindFolder', `Раздел ${runId}`, 'blue'],
        ['kindVolume', `Том ${runId}`, 'green'],
      ] as const) {
        const row = await prisma.nodeKind.create({
          data: { name, icon: 'folder', color },
        });
        w.cleanupIds.nodeKinds.push(row.id);
        if (slot === 'kindFolder') kindFolder = row.id;
        else kindVolume = row.id;
      }
      const addNode = async (
        kindId: string,
        name: string,
        parentId: string | null,
        mark?: string,
      ) => {
        const row = await prisma.projectNode.create({
          data: {
            projectId,
            kindId,
            name: `${name} ${runId}`,
            order: `cs${w.cleanupIds.nodes.length}`,
            parentId,
            ...(mark ? { customFields: { [w.field.get('folderMark')!]: mark } as never } : {}),
          },
        });
        w.cleanupIds.nodes.push(row.id);
        return row.id;
      };
      folderKzh = await addNode(kindFolder, 'Раздел КЖ', null, 'КЖ');
      folderVolume = await addNode(kindVolume, 'Том 1', null);
      folderNested = await addNode(kindFolder, 'Раздел АР', folderKzh);

      const t = (args: Parameters<ConditionWorld['addTask']>[0]) =>
        w.addTask({ markField: 'taskMark', project: projectId, ...args });

      hostParent = await t({ title: 'Родитель host', mark: 'PARENT' });
      host = await t({ title: 'Хост субъекты', mark: 'HOST', parent: hostParent, node: folderKzh });
      siblingConfidential = await t({
        title: 'Соседняя по папке',
        node: folderKzh,
        assignee: w.carol.id,
        confidential: true,
      });
      volumeTask = await t({ title: 'Задача тома', mark: 'F2T', node: folderVolume });
      nestedTask = await t({ title: 'Задача вложенного раздела', mark: 'F3T', node: folderNested });
      noProjectHost = await t({ title: 'Без проекта', project: null });

      // Подзадачи host: живые/удалённая, системные состояния, тип Т3.
      await t({ title: 'Подзадача А', mark: 'X', parent: host });
      await t({ title: 'Подзадача Б', mark: 'Y', parent: host });
      await t({ title: 'Подзадача удалённая', mark: 'X', parent: host, deleted: true });
      await t({ title: 'st-new', parent: host, stageId: w.stage.new, systemState: 'backlog' });
      await t({ title: 'st-work', parent: host, stageId: w.stage.work, systemState: 'active' });
      await t({ title: 'st-paused', parent: host, stageId: w.stage.paused, systemState: 'paused' });
      await t({ title: 'st-control', parent: host, stageId: w.stage.control, systemState: 'done' });
      await t({ title: 'st-done', parent: host, stageId: w.stage.done, systemState: 'closed' });
      await t({
        title: 'st-cancelled',
        parent: host,
        stageId: w.stage.cancelled,
        systemState: 'closed',
      });
      const t3t = (code: string, state: string) =>
        t({
          title: `т3-${code}`,
          mark: 'T3',
          parent: host,
          typeId: t3TypeId,
          workflowId: w3WorkflowId,
          stageId: w3Stage[code] as string,
          systemState: state,
        });
      await t3t('draft', 'backlog');
      await t3t('printed', 'active');
      await t3t('done', 'closed');
      await t3t('cancelled', 'closed');
      await t3t('rejected', 'closed');

      // Связи: relates out/in, blocks, precedes, duplicates.
      relA = await t({ title: 'Связанная А' });
      relB = await t({ title: 'Связанная Б' });
      const blkA = await t({ title: 'Блокирующая' });
      const precA = await t({ title: 'Предшествующая' });
      const dupA = await t({ title: 'Дубликат' });
      for (const [from, to, kind] of [
        [host, relA, 'relates'],
        [relB, host, 'relates'],
        [host, blkA, 'blocks'],
        [host, precA, 'precedes'],
        [host, dupA, 'duplicates'],
      ] as const) {
        const row = await prisma.taskRelation.create({
          data: { fromTaskId: from, toTaskId: to, kind, createdBy: w.alice.id },
        });
        w.cleanupIds.relations.push(row.id);
      }

      // Хосты кванторов: 0 / 1 из 2 / 2 из 2 подходящих подзадач.
      quantHost.q0 = await t({ title: 'Квантор 0' });
      quantHost.q1 = await t({ title: 'Квантор 1' });
      await t({ title: 'q-подходящая', mark: 'X', parent: quantHost.q1 });
      await t({ title: 'q-мимо', mark: 'Y', parent: quantHost.q1 });
      quantHost.q2 = await t({ title: 'Квантор 2' });
      await t({ title: 'q2-первая', mark: 'X', parent: quantHost.q2 });
      await t({ title: 'q2-вторая', mark: 'X', parent: quantHost.q2 });

      // Ссылки host: task/letter/project/node — живые цели; user/dept/CP — не записи.
      await prisma.task.update({
        where: { id: host },
        data: {
          customFields: {
            [w.field.get('taskMark')!]: 'HOST',
            [w.field.get('refTask')!]: relA,
            [w.field.get('refLetter')!]: letterId,
            [w.field.get('refProject')!]: projectId,
            [w.field.get('refNode')!]: folderVolume,
            [w.field.get('refUser')!]: w.bob.id,
            [w.field.get('refDept')!]: crypto.randomUUID(),
            [w.field.get('refCP')!]: crypto.randomUUID(),
          } as never,
        },
      });

      // Кнопки-пробы: таблица «ключ → выборка».
      const q = (
        subject: ConditionQuery['subject'],
        where: ConditionQuery['where'] = [],
        quantifier: ConditionQuery['quantifier'] = 'none',
      ): ConditionQuery => ({ subject, where, quantifier });
      const fieldEq = (key: string, value: unknown) =>
        ({
          kind: 'field',
          field: w.cf(key),
          op: 'eq',
          value,
        }) as ConditionQuery['where'][number];
      const probes: [string, ConditionQuery][] = [
        ['self', q({ kind: 'self' })],
        ['self:mark', q({ kind: 'self' }, [fieldEq('taskMark', 'HOST')])],
        ['parent', q({ kind: 'parent_task' })],
        ['subtasks', q({ kind: 'subtasks' })],
        ['folder', q({ kind: 'folder_tasks' })],
        ['project:tasks', q({ kind: 'project_tasks' }, [{ kind: 'type_is', typeId: t3TypeId }])],
        ['folders:all', q({ kind: 'project_folders' })],
        ['folders:kind', q({ kind: 'project_folders', folderTypeId: kindFolder })],
        ['folders:volume', q({ kind: 'project_folders', folderTypeId: kindVolume })],
        ['folders:mark', q({ kind: 'project_folders' }, [fieldEq('folderMark', 'КЖ')])],
        [
          'folders:stage',
          q({ kind: 'project_folders' }, [{ kind: 'system_state', state: 'closed' }]),
        ],
        [
          'ftype:kind',
          q({ kind: 'folder_type_tasks', folderTypeId: kindFolder }, [fieldEq('taskMark', 'F3T')]),
        ],
        [
          'ftype:volume',
          q({ kind: 'folder_type_tasks', folderTypeId: kindVolume }, [fieldEq('taskMark', 'F2T')]),
        ],
        [
          'ftype:foreign',
          q({ kind: 'folder_type_tasks', folderTypeId: kindVolume }, [fieldEq('taskMark', 'F3T')]),
        ],
        ['project', q({ kind: 'project' })],
        ['project:mark', q({ kind: 'project' }, [fieldEq('projectMark', 'СД')])],
        ['project:stage', q({ kind: 'project' }, [{ kind: 'system_state', state: 'active' }])],
        ['type:own', q({ kind: 'subtasks' }, [{ kind: 'type_is', typeId: w.taskTypeId }])],
        ['type:t3', q({ kind: 'subtasks' }, [{ kind: 'type_is', typeId: t3TypeId }])],
        [
          'stage:work',
          q({ kind: 'subtasks' }, [
            { kind: 'type_is', typeId: w.taskTypeId },
            { kind: 'stage_is', stageId: w.stage.work },
          ]),
        ],
        [
          'stage:miss',
          q({ kind: 'subtasks' }, [
            { kind: 'type_is', typeId: w.taskTypeId },
            { kind: 'stage_is', stageId: w3Stage.printed! },
          ]),
        ],
        [
          'issued:std',
          q({ kind: 'subtasks' }, [
            { kind: 'type_is', typeId: w.taskTypeId },
            { kind: 'result_issued' },
          ]),
        ],
        [
          'issued:t3:none',
          q({ kind: 'subtasks' }, [
            { kind: 'type_is', typeId: t3TypeId },
            { kind: 'result_issued' },
          ]),
        ],
        [
          'issued:t3:all',
          q(
            { kind: 'subtasks' },
            [{ kind: 'type_is', typeId: t3TypeId }, { kind: 'result_issued' }],
            'all',
          ),
        ],
      ];
      for (const relation of ['relates', 'blocks', 'precedes', 'duplicates'] as const) {
        for (const direction of ['out', 'in', 'both'] as const) {
          probes.push([
            `rel:${relation}:${direction}`,
            q({ kind: 'relations', relation, direction }),
          ]);
        }
      }
      for (const key of [
        'refTask',
        'refLetter',
        'refProject',
        'refNode',
        'refUser',
        'refDept',
        'refCP',
      ]) {
        probes.push([`ref:${key}`, q({ kind: 'ref_field', field: w.cf(key) })]);
      }
      for (const state of ['backlog', 'active', 'paused', 'done', 'closed'] as const) {
        probes.push([`state:${state}`, q({ kind: 'subtasks' }, [{ kind: 'system_state', state }])]);
      }
      for (const outcome of ['success', 'cancelled', 'rejected'] as const) {
        probes.push([
          `outcome:${outcome}`,
          q({ kind: 'subtasks' }, [{ kind: 'outcome', outcome }]),
        ]);
      }
      const markX: ConditionQuery['where'] = [fieldEq('taskMark', 'X')];
      for (const quantifier of ['all', 'any', 'none'] as const) {
        for (const hostKey of ['q0', 'q1', 'q2'] as const) {
          probes.push([`${hostKey}:${quantifier}`, q({ kind: 'subtasks' }, markX, quantifier)]);
        }
      }
      for (const [key, query] of probes) {
        await w.addRecordsProbe({ key, query });
      }
    }, 240_000);

    afterAll(async () => {
      await w?.cleanup();
    });

    it('self: запись-хост сама в выборке, поле читается', async () => {
      const reason = await w.reasonOf(w.bob, host, 'self');
      expect(reason?.records?.map((r) => r.id)).toEqual([host]);
      expect(reason?.records?.[0]?.entityKind).toBe('task');
      expect(await w.reasonOf(w.bob, host, 'self:mark')).not.toBeNull();
    });

    it('parent_task: есть родитель — одна запись; нет родителя — пусто', async () => {
      const reason = await w.reasonOf(w.bob, host, 'parent');
      expect(reason?.records?.map((r) => r.id)).toEqual([hostParent]);
      expect(await w.reasonOf(w.bob, noProjectHost, 'parent')).toBeNull();
    });

    it('subtasks: живые входят, мягко удалённые исключены', async () => {
      const reason = await w.reasonOf(w.bob, host, 'subtasks');
      const ids = new Set(reason?.records?.map((r) => r.id) ?? []);
      expect(ids.size).toBe(5);
      const subA = await w.prisma.task.findFirstOrThrow({
        where: { title: `Подзадача А ${w.runId}`, deletedAt: null },
      });
      expect(ids.has(subA.id)).toBe(true);
      const deleted = await w.prisma.task.findFirst({
        where: { parentId: host, deletedAt: { not: null } },
      });
      expect(deleted).not.toBeNull();
      expect(ids.has(deleted!.id)).toBe(false);
    });

    it.each([
      ['relates', 'out', ['Связанная А']],
      ['relates', 'in', ['Связанная Б']],
      ['relates', 'both', ['Связанная А', 'Связанная Б']],
      ['blocks', 'out', ['Блокирующая']],
      ['blocks', 'in', []],
      ['precedes', 'out', ['Предшествующая']],
      ['precedes', 'in', []],
      ['duplicates', 'both', ['Дубликат']],
    ] as const)(
      'relations %s/%s — выборка по виду и направлению',
      async (relation, direction, titles) => {
        const reason = await w.reasonOf(w.bob, host, `rel:${relation}:${direction}`);
        if (titles.length === 0) {
          expect(reason).toBeNull();
          return;
        }
        expect(reason?.records?.map((r) => r.name).sort()).toEqual(
          titles.map((t) => `${t} ${w.runId}`).sort(),
        );
      },
    );

    it('folder_tasks: задачи узла записи; конфиденциальная соседка скрыта в причине', async () => {
      const reason = await w.reasonOf(w.bob, host, 'folder');
      const ids = reason?.records?.map((r) => r.id) ?? [];
      expect(ids).toContain(host);
      expect(ids).not.toContain(siblingConfidential);
      expect(reason?.hiddenCount).toBe(1);
      expect(ids).not.toContain(volumeTask);
    });

    it('project_tasks: задачи проекта по фильтру типа; без проекта — пусто', async () => {
      const reason = await w.reasonOf(w.bob, host, 'project:tasks');
      expect(reason?.records?.length).toBe(5);
      expect(reason?.hiddenCount).toBe(0);
      const res = await w.fx.api(w.bob, 'GET', `/tasks/${noProjectHost}/transitions`);
      expect(res.status).toBe(200);
      const list = (await res.json()) as { id: string; blockedBy: unknown[] }[];
      expect(list.find((t) => t.id === w.probeOf.get('project:tasks'))?.blockedBy ?? []).toEqual(
        [],
      );
    });

    it('project_folders: все папки / по виду / поле папки; статусов у папки нет', async () => {
      const all = await w.reasonOf(w.bob, host, 'folders:all');
      expect(all?.records?.map((r) => r.id).sort()).toEqual(
        [folderKzh, folderNested, folderVolume].sort(),
      );
      expect(all?.records?.every((r) => r.entityKind === 'node')).toBe(true);
      const kind = await w.reasonOf(w.bob, host, 'folders:kind');
      expect(kind?.records?.map((r) => r.id).sort()).toEqual([folderKzh, folderNested].sort());
      const volume = await w.reasonOf(w.bob, host, 'folders:volume');
      expect(volume?.records?.map((r) => r.id)).toEqual([folderVolume]);
      const mark = await w.reasonOf(w.bob, host, 'folders:mark');
      expect(mark?.records?.map((r) => r.id)).toEqual([folderKzh]);
      expect(await w.reasonOf(w.bob, host, 'folders:stage')).toBeNull();
    });

    it('folder_type_tasks: работы в папках вида, включая вложенные; чужой вид — нет', async () => {
      const nested = await w.reasonOf(w.bob, host, 'ftype:kind');
      expect(nested?.records?.map((r) => r.id)).toEqual([nestedTask]);
      const volume = await w.reasonOf(w.bob, host, 'ftype:volume');
      expect(volume?.records?.map((r) => r.id)).toEqual([volumeTask]);
      expect(await w.reasonOf(w.bob, host, 'ftype:foreign')).toBeNull();
    });

    it('project: сам проект с полями; предикаты этапа по проекту ложны', async () => {
      const reason = await w.reasonOf(w.bob, host, 'project');
      expect(reason?.records?.map((r) => r.id)).toEqual([projectId]);
      expect(reason?.records?.[0]?.entityKind).toBe('project');
      expect(await w.reasonOf(w.bob, host, 'project:mark')).not.toBeNull();
      expect(await w.reasonOf(w.bob, host, 'project:stage')).toBeNull();
    });

    it.each([
      ['refTask', 'task'],
      ['refLetter', 'letter'],
      ['refProject', 'project'],
      ['refNode', 'node'],
      ['refUser', null],
      ['refDept', null],
      ['refCP', null],
    ] as const)('ref_field %s: записи по ссылке из поля', async (key, entityKind) => {
      // Незарегистрированное письмо видит только канцелярия — проба от alice.
      const user = key === 'refLetter' ? w.alice : w.bob;
      const reason = await w.reasonOf(user, host, `ref:${key}`);
      if (entityKind === null) {
        // Сотрудник/подразделение/контрагент — не записи движка: пусто.
        expect(reason).toBeNull();
        return;
      }
      expect(reason?.records).toHaveLength(1);
      expect(reason?.records?.[0]?.entityKind).toBe(entityKind);
    });

    it.each([
      // any на пустом множестве — ложь (причина без записей); all/none — истина.
      ['q0', false, true, false],
      ['q1', true, false, true],
      ['q2', false, false, true],
    ] as const)(
      'кванторы на %s: all/any/none по числу подходящих',
      async (hostKey, allBlocked, anyBlocked, noneBlocked) => {
        const taskId = quantHost[hostKey];
        expect((await w.reasonOf(w.bob, taskId, `${hostKey}:all`)) !== null).toBe(allBlocked);
        expect((await w.reasonOf(w.bob, taskId, `${hostKey}:any`)) !== null).toBe(anyBlocked);
        expect((await w.reasonOf(w.bob, taskId, `${hostKey}:none`)) !== null).toBe(noneBlocked);
      },
    );

    it('квантор all на пустом множестве — истина; none на пустом — истина (зафиксировано)', async () => {
      expect(await w.reasonOf(w.bob, quantHost.q0, 'q0:all')).toBeNull();
      expect(await w.reasonOf(w.bob, quantHost.q0, 'q0:none')).toBeNull();
    });

    it('type_is: свой тип и пользовательский тип различаются', async () => {
      const own = await w.reasonOf(w.bob, host, 'type:own');
      expect(own?.records?.length).toBe(5);
      const t3 = await w.reasonOf(w.bob, host, 'type:t3');
      expect(t3?.records?.length).toBe(5);
    });

    it('stage_is: совпадает/не совпадает (с type_is в той же выборке)', async () => {
      const reason = await w.reasonOf(w.bob, host, 'stage:work');
      expect(reason?.records?.map((r) => r.name)).toEqual([`st-work ${w.runId}`]);
      expect(await w.reasonOf(w.bob, host, 'stage:miss')).toBeNull();
    });

    it.each([
      ['backlog', 'st-new'],
      ['active', 'st-work'],
      ['paused', 'st-paused'],
      ['done', 'st-control'],
      ['closed', 'st-done'],
    ] as const)('system_state %s находит подзадачу на стадии', async (state, title) => {
      const reason = await w.reasonOf(w.bob, host, `state:${state}`);
      const names = reason?.records?.map((r) => r.name) ?? [];
      expect(names).toContain(`${title} ${w.runId}`);
    });

    it('outcome: success/cancelled/rejected по итогу закрытия', async () => {
      const success = await w.reasonOf(w.bob, host, 'outcome:success');
      expect(success?.records?.map((r) => r.name).sort()).toEqual(
        [`st-done ${w.runId}`, `т3-done ${w.runId}`].sort(),
      );
      const cancelled = await w.reasonOf(w.bob, host, 'outcome:cancelled');
      expect(cancelled?.records?.length).toBe(2);
      const rejected = await w.reasonOf(w.bob, host, 'outcome:rejected');
      expect(rejected?.records?.map((r) => r.name)).toEqual([`т3-rejected ${w.runId}`]);
    });

    it('result_issued: без отметок — закрыта успешно; с отметкой — с неё и все после', async () => {
      // Системный маршрут без отметок: выдана = закрыта успешно.
      const std = await w.reasonOf(w.bob, host, 'issued:std');
      expect(std?.records?.map((r) => r.name)).toEqual([`st-done ${w.runId}`]);
      // Маршрут Т3 с отметкой на «printed»: выданы printed и всё после
      // (done/cancelled/rejected), до отметки (draft) — не выдана.
      const none = await w.reasonOf(w.bob, host, 'issued:t3:none');
      expect(none?.records?.map((r) => r.name).sort()).toEqual(
        ['т3-printed', 'т3-done', 'т3-cancelled', 'т3-rejected']
          .map((x) => `${x} ${w.runId}`)
          .sort(),
      );
      // «Все (типа Т3 и выданы)»: квантор all идёт по ПОЛНОЙ выборке
      // подзадач — записи чужого типа не проходят type_is и становятся
      // нарушителями. Семантика развилки (type_is как фильтр домена или как
      // условие записи) — открытый вопрос владельцу, поведение зафиксировано.
      const all = await w.reasonOf(w.bob, host, 'issued:t3:all');
      expect(all).not.toBeNull();
      expect(all?.records?.map((r) => r.name)).toContain(`Подзадача А ${w.runId}`);
    });
  },
);
