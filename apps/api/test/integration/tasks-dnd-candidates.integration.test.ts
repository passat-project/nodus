import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  ErrorCode,
  fieldLocksOf,
  Permission,
  taskDetailSchema,
  taskListItemSchema,
  workflowTransitionSchema,
} from '@nodus/contracts';
import { z } from 'zod';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * DnD с двумя кандидатами в один статус (#866, AUD-008): исполняется кнопка,
 * чьи гейты прошли, — её окно и замки. Заменная кнопка с обязательным окном
 * даёт 422 (жест окно не открывает), без окна — исполняется, замки нажатой
 * первой кнопки не применяются. Живое HTTP + БД.
 */

const assigneeOnly = {
  conditions: [{ kind: 'role_in', roles: ['assignee'] }],
  validators: [],
  postFunctions: [],
};
const failsResultGate = {
  conditions: [{ kind: 'role_in', roles: ['assignee'] }],
  validators: [{ kind: 'result_present' }],
  postFunctions: [],
};
const pauseForm = {
  enabled: true,
  sections: [{ kind: 'comment', label: 'Причина приостановки', required: true }],
};

describe.skipIf(!process.env.DATABASE_URL)(
  'tasks: DnD с двумя кандидатами (integration, #866, AUD-008)',
  () => {
    let fx: ChatTestFixture<'alice' | 'bob'>;
    let alice: ChatUser;
    let bob: ChatUser;
    const taskIds: string[] = [];
    const createdTransitionIds: string[] = [];

    beforeAll(async () => {
      fx = await setupChatFixture(['alice', 'bob']);
      await fx.prisma.featureFlag.upsert({
        where: { key: 'tasks' },
        update: { enabled: true },
        create: { key: 'tasks', enabled: true },
      });
      const tokens = fx.app.get(TokenService);
      const withCreate = async (u: ChatUser): Promise<ChatUser> => ({
        ...u,
        token: await tokens.signAccessToken(
          {
            id: u.id,
            email: u.email,
            displayName: u.displayName,
            permissions: [Permission.TASK_CREATE],
          },
          'integration-test-session',
        ),
      });
      alice = await withCreate(fx.users.alice);
      bob = await withCreate(fx.users.bob);
      // Детерминизм против прошлых прогонов: окна системных кнопок сбрасываются,
      // тесты настраивают нужные сами (как в tasks-transition-window).
      const standard = await fx.prisma.workflow.findUnique({ where: { code: 'task.default' } });
      if (standard) {
        await fx.prisma.workflowTransition.updateMany({
          where: { workflowId: standard.id },
          data: { form: {} },
        });
      }
    }, 120_000);

    afterAll(async () => {
      if (fx && createdTransitionIds.length > 0) {
        await fx.prisma.workflowTransition.deleteMany({
          where: { id: { in: createdTransitionIds } },
        });
      }
      if (fx && taskIds.length > 0) {
        await fx.prisma.task.updateMany({
          where: { parentId: { in: taskIds } },
          data: { parentId: null },
        });
        await fx.prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      }
      await fx?.cleanup();
    });

    /** Задача alice на bob в колонке «В работе»: старт — кнопкой маршрута. */
    async function startedTask(slug: string): Promise<{ id: string; workflowId: string }> {
      const res = await fx.api(alice, 'POST', '/tasks', {
        body: { title: `DnD кандидаты ${slug} ${fx.runId}`, assigneeId: bob.id },
        key: `it-aud008-${slug}-${fx.runId}`,
      });
      expect(res.status).toBe(201);
      const task = taskListItemSchema.parse(await res.json());
      taskIds.push(task.id);
      const detail = taskDetailSchema.parse(
        await (await fx.api(bob, 'GET', `/tasks/${task.id}`)).json(),
      );
      const buttons = z
        .array(workflowTransitionSchema)
        .parse(await (await fx.api(bob, 'GET', `/tasks/${task.id}/transitions`)).json());
      const start = buttons.find((t) => t.name === 'Взять в работу');
      expect(start).toBeDefined();
      const started = await fx.api(bob, 'POST', `/tasks/${task.id}/transitions/${start!.id}`, {
        body: {},
        key: `it-aud008-start-${slug}-${fx.runId}`,
      });
      expect(started.status).toBe(200);
      return { id: task.id, workflowId: detail.workflowId };
    }

    async function columns(workflowId: string) {
      const inProgress = await fx.prisma.workflowStage.findFirstOrThrow({
        where: { workflowId, name: 'В работе', archivedAt: null },
      });
      const paused = await fx.prisma.workflowStage.findFirstOrThrow({
        where: { workflowId, name: 'Приостановлена', archivedAt: null },
      });
      // «Отложена» — цель только для созданных кнопок (штатная «Отложить»
      // идёт из «Приостановлена»): ровно два кандидата, без третьего.
      const postponed = await fx.prisma.workflowStage.findFirstOrThrow({
        where: { workflowId, name: 'Отложена', archivedAt: null },
      });
      return { inProgress, paused, postponed };
    }

    /** Вторая кнопка в тот же статус — как её создал бы редактор маршрута. */
    async function addTransition(
      workflowId: string,
      slug: string,
      fromStageId: string,
      toStageId: string,
      input: { name: string; rules: unknown; form: unknown; sortOrder: number },
    ): Promise<string> {
      const row = await fx.prisma.workflowTransition.create({
        data: {
          workflowId,
          code: `it-aud008-${slug}-${fx.runId}`,
          name: input.name,
          fromStageId,
          toStageId,
          display: 'button',
          intent: 'service',
          sortOrder: input.sortOrder,
          rules: input.rules as never,
          form: input.form as never,
        },
      });
      createdTransitionIds.push(row.id);
      return row.id;
    }

    it('гейт первой не прошёл, у второй обязательное окно — 422, переход не выполнен', async () => {
      const task = await startedTask('window');
      const { inProgress, paused } = await columns(task.workflowId);
      const pause = await fx.prisma.workflowTransition.findFirstOrThrow({
        where: { workflowId: task.workflowId, name: 'Приостановить', archivedAt: null },
      });
      await fx.prisma.workflowTransition.update({
        where: { id: pause.id },
        data: { form: pauseForm as never },
      });
      await addTransition(task.workflowId, 'window', inProgress.id, paused.id, {
        name: 'Первая без окна',
        rules: failsResultGate,
        form: {},
        sortOrder: 100,
      });

      const recordsBefore = await fx.prisma.transitionRecord.count({
        where: { entityId: task.id },
      });
      const res = await fx.api(bob, 'PATCH', `/tasks/${task.id}`, {
        body: { stageId: paused.id },
        key: `it-aud008-window-${fx.runId}`,
      });
      expect(res.status).toBe(422);
      const error = apiErrorResponseSchema.parse(await res.json());
      expect(error.code).toBe(ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID);
      expect(error.details).toMatchObject({ transitionId: pause.id, missing: ['comment'] });

      const fresh = await fx.prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(fresh.stageId).toBe(inProgress.id);
      expect(await fx.prisma.transitionRecord.count({ where: { entityId: task.id } })).toBe(
        recordsBefore,
      );
    });

    it('заменная кнопка без окна исполняется: её замки, замки первой не применены', async () => {
      const task = await startedTask('locks');
      const { inProgress, postponed } = await columns(task.workflowId);
      await addTransition(task.workflowId, 'locks-first', inProgress.id, postponed.id, {
        name: 'Первая без окна',
        rules: failsResultGate,
        form: { enabled: true, sections: [], locks: [{ key: 'priority', editors: 'none' }] },
        sortOrder: 100,
      });
      const secondId = await addTransition(
        task.workflowId,
        'locks-second',
        inProgress.id,
        postponed.id,
        {
          name: 'Вторая без окна',
          rules: assigneeOnly,
          form: { enabled: true, sections: [], locks: [{ key: 'deadline', editors: 'none' }] },
          sortOrder: 101,
        },
      );

      const res = await fx.api(bob, 'PATCH', `/tasks/${task.id}`, {
        body: { stageId: postponed.id },
        key: `it-aud008-locks-${fx.runId}`,
      });
      expect(res.status).toBe(200);

      const fresh = await fx.prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(fresh.stageId).toBe(postponed.id);
      const record = await fx.prisma.transitionRecord.findFirstOrThrow({
        where: { entityId: task.id, recordKind: 'transition' },
        orderBy: { createdAt: 'desc' },
      });
      expect(record.transitionId).toBe(secondId);
      const locks = fieldLocksOf(fresh.fieldLocks);
      expect(locks.deadline?.editors).toBe('none');
      expect(locks.priority).toBeUndefined();
    });
  },
);
