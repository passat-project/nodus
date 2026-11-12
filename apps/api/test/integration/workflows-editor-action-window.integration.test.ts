import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, Permission } from '@nodus/contracts';

import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';

/**
 * Публикация действия с включённым, но пустым окном (#633, ответ владельца
 * 12.11): окно открывается пустым и каждое нажатие штампует бессмысленную
 * запись в журнал — сервер отклоняет документ 422, в БД ничего не пишется.
 * Путь «с полем» публикуется (окно работает), затем демо-действие убирается.
 */
describe.skipIf(!process.env.DATABASE_URL)(
  'workflows: пустое окно действия не публикуется (integration, #633)',
  () => {
    let fx: ChatTestFixture<'admin'>;
    let admin: ChatUser;
    let workflowId = '';
    let workStageId = '';
    let baseVersion = 0;
    let baseDocument: {
      stages: unknown[];
      transitions: unknown[];
      actions?: unknown[];
    };

    const actionOf = (form: { enabled: boolean; sections: unknown[] }, name: string) => ({
      id: `new:00000000-0000-4000-8000-0000000000c1`,
      code: null,
      name,
      stageId: workStageId,
      display: 'button',
      sortOrder: 0,
      rules: {
        conditions: [{ kind: 'role_in', roles: ['assignee'] }],
        validators: [],
        postFunctions: [],
      },
      form,
      steps: [],
    });

    beforeAll(async () => {
      fx = await setupChatFixture(['admin']);
      const tokens = fx.app.get(TokenService);
      admin = {
        ...fx.users.admin,
        token: await tokens.signAccessToken(
          {
            id: fx.users.admin.id,
            email: fx.users.admin.email,
            displayName: fx.users.admin.displayName,
            permissions: [Permission.WORKFLOW_MANAGE, Permission.TASK_MANAGE_ANY],
          },
          'integration-test-session',
        ),
      };
      const types = (await (
        await fx.api(admin, 'GET', '/workflows/types?archived=include')
      ).json()) as { code: string; workflowId: string }[];
      workflowId = types.find((t) => t.code === 'task')!.workflowId;
      const detail = (await (await fx.api(admin, 'GET', `/workflows/${workflowId}`)).json()) as {
        version: number;
        document: {
          stages: { id: string; name: string }[];
          transitions: unknown[];
          actions?: unknown[];
        };
      };
      baseVersion = detail.version;
      baseDocument = detail.document;
      workStageId = detail.document.stages.find((s) => s.name === 'В работе')!.id;
    }, 120_000);

    afterAll(async () => {
      await fx?.cleanup();
    });

    it('422 WORKFLOW_INVALID с понятным русским сообщением, в БД пусто', async () => {
      const before = await fx.prisma.workflowAction.count({
        where: { workflowId, archivedAt: null },
      });
      const name = `Проверка пустого окна ${fx.runId}`;
      const refused = await fx.api(admin, 'POST', `/workflows/${workflowId}/publish`, {
        body: {
          baseVersion,
          document: {
            ...baseDocument,
            actions: [actionOf({ enabled: true, sections: [] }, name)],
          },
          migrations: [],
        },
        key: `it-action-empty-${fx.runId}`,
      });
      expect(refused.status).toBe(422);
      const body = (await refused.json()) as {
        code: string;
        message: string;
        details?: { problems?: { code: string; actionId?: string }[] };
        traceId?: string;
      };
      expect(body.code).toBe(ErrorCode.WORKFLOW_INVALID);
      expect(body.message).toContain(`В действии «${name}»`);
      expect(body.message).toContain('включено окно, но не выбрано ни одного раздела');
      expect(body.traceId).toBeTruthy();
      expect(body.details?.problems).toContainEqual(
        expect.objectContaining({ code: 'action_window_empty' }),
      );

      // Ничего не записано: ни строки действия, ни новой версии.
      expect(
        await fx.prisma.workflowAction.count({ where: { workflowId, archivedAt: null } }),
      ).toBe(before);
      const fresh = (await (await fx.api(admin, 'GET', `/workflows/${workflowId}`)).json()) as {
        version: number;
      };
      expect(fresh.version).toBe(baseVersion);
    });

    it('то же действие с полем в окне публикуется, затем убирается', async () => {
      const name = `Проверка окна с полем ${fx.runId}`;
      const published = await fx.api(admin, 'POST', `/workflows/${workflowId}/publish`, {
        body: {
          baseVersion,
          document: {
            ...baseDocument,
            actions: [
              actionOf(
                {
                  enabled: true,
                  sections: [{ kind: 'comment', label: 'Что уточнить', required: true }],
                },
                name,
              ),
            ],
          },
          migrations: [],
        },
        key: `it-action-field-${fx.runId}`,
      });
      expect(published.status).toBe(200);
      const version = ((await published.json()) as { version: number }).version;
      const saved = (await (await fx.api(admin, 'GET', `/workflows/${workflowId}`)).json()) as {
        document: { actions: { name: string; form: { sections: { label?: string }[] } }[] };
      };
      const live = saved.document.actions.find((a) => a.name === name);
      expect(live?.form.sections[0]?.label).toBe('Что уточнить');

      // Возвращаем каталог в исходное состояние: документа без действий.
      const restored = await fx.api(admin, 'POST', `/workflows/${workflowId}/publish`, {
        body: { baseVersion: version, document: { ...baseDocument, actions: [] }, migrations: [] },
        key: `it-action-restore-${fx.runId}`,
      });
      expect(restored.status).toBe(200);
    });
  },
);
