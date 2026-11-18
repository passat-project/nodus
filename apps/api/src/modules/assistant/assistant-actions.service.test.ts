import { describe, expect, it, vi } from 'vitest';
import type { AssistantToolDefinition, ToolContext } from './tools/tool-definition.js';
import { findAnyTool } from './tools/catalog.js';
import type { AssistantRepository, ActionRow } from './assistant.repository.js';
import type { ToolExecution, ToolExecutorService } from './tools/tool-executor.service.js';
import type { RunBusService } from './run-bus.service.js';
import type { AuditRepository } from '../../core/audit/audit.repository.js';

import { AssistantActionsService } from './assistant-actions.service.js';

/**
 * Карточки действий (Ф2, #899, ADR-0048): предложение НЕ пишет в портал, запись — только
 * подтверждение/байпас, идемпотентность = id карточки, чужая — 404, отмена — DELETE.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACTION_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-27T10:00:00.000Z');

const tools = {
  create: findAnyTool('tasks.create') as AssistantToolDefinition,
  update: findAnyTool('tasks.update') as AssistantToolDefinition,
};

function actionRow(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    id: ACTION_ID,
    runId: RUN_ID,
    messageId: 'message-1',
    userId: USER_ID,
    toolId: 'tasks.create',
    title: 'Создать задачу',
    summary: 'Задача «Смета»',
    fields: [{ label: 'Название', value: 'Смета' }],
    consequences: 'Задача появится в портале',
    undoable: true,
    automatic: false,
    state: 'proposed',
    args: { title: 'Смета' },
    resultData: null,
    resultPreview: null,
    href: null,
    hrefLabel: null,
    errorCode: null,
    executedAt: null,
    undoneAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const ctx: ToolContext = {
  authorization: 'Bearer user-token',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  read: async (path: string) =>
    path.startsWith('/directory/users/')
      ? { id: '44444444-4444-4444-8444-444444444444', displayName: 'Иванов Иван' }
      : { id: '55555555-5555-4555-8555-555555555555', name: 'Смета-2026' },
};

function build(row: ActionRow = actionRow()) {
  // Мутабельное состояние строки: claim/finish реально меняют карточку —
  // иначе повторный клик и отмена проверялись бы на устаревшей копии.
  let current = { ...row };
  const repo = {
    countRunActions: vi.fn(async () => 0),
    ensureActionBatch: vi.fn(async () => undefined),
    createActionWithinLimit: vi.fn(
      async (input: Record<string, unknown>): Promise<ActionRow | null> => {
        void input;
        return row;
      },
    ),
    findAction: vi.fn(async (): Promise<ActionRow | null> => current),
    claimAction: vi.fn(async (_id: string, from: readonly string[], to: string) => {
      if (!from.includes(current.state)) return false;
      current = { ...current, state: to, updatedAt: new Date() };
      return true;
    }),
    finishAction: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
      current = { ...current, ...patch, updatedAt: new Date() };
      return current;
    }),
  };
  const executor = {
    executeWrite: vi.fn(async (): Promise<ToolExecution> => ({
      ok: true,
      text: 'Задача создана: №5 «Смета», id task-1',
      entity: { href: '?cards=task:task-1', label: '№5 Смета' },
      data: { id: 'task-1' },
    })),
    executeUndo: vi.fn(async (): Promise<ToolExecution> => ({
      ok: true,
      text: 'Созданное удалено',
    })),
  };
  const bus = { publish: vi.fn(async () => undefined) };
  const audit = { append: vi.fn(async () => undefined) };
  const logger = { setContext: () => undefined, warn: () => undefined, error: () => undefined };
  const service = new AssistantActionsService(
    repo as unknown as AssistantRepository,
    executor as unknown as ToolExecutorService,
    bus as unknown as RunBusService,
    audit as unknown as AuditRepository,
    logger as never,
  );
  return { service, repo, executor, bus, audit };
}

describe('AssistantActionsService: предложение (ADR-0048)', () => {
  it('без байпаса карточка создаётся, но записи в портал НЕТ', async () => {
    const { service, repo, executor, bus } = build();
    const result = await service.propose({
      runId: RUN_ID,
      sessionId: 'session-1',
      messageId: 'message-1',
      userId: USER_ID,
      tool: tools.create,
      rawInput: { title: 'Смета', assigneeId: '44444444-4444-4444-8444-444444444444' },
      automatic: false,
      authorization: 'Bearer user-token',
      ctx,
    });

    expect(executor.executeWrite).not.toHaveBeenCalled();
    expect(repo.createActionWithinLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: 'tasks.create',
        title: 'Создать задачу',
        automatic: false,
        undoable: true,
      }),
      5,
    );
    // Поля показывают имена, а не id (ctx.read дочитал сотрудника).
    const created = repo.createActionWithinLimit.mock.calls[0]![0] as unknown as {
      fields: { value: string }[];
    };
    expect(created.fields.map((field) => field.value)).toEqual(
      expect.arrayContaining(['Смета', 'Иванов Иван']),
    );
    expect(result.text).toContain('ждёт подтверждения');
    expect(bus.publish).toHaveBeenCalledWith(RUN_ID, 'action.proposed', expect.anything());
  });

  it('атомарный лимит: гонка write-вызовов не создаёт лишнюю карточку', async () => {
    const { service, repo } = build();
    repo.createActionWithinLimit.mockResolvedValueOnce(null);
    const result = await service.propose({
      runId: RUN_ID,
      sessionId: 'session-1',
      messageId: 'message-1',
      userId: USER_ID,
      tool: tools.create,
      rawInput: { title: 'Смета' },
      automatic: false,
      authorization: 'Bearer user-token',
      ctx,
    });
    expect(result.action).toBeNull();
    expect(result.text).toContain('ASSISTANT_TOO_MANY_ACTIONS');
  });

  it('байпас: карточка исполняется сразу, id карточки — ключ идемпотентности', async () => {
    const { service, executor, bus } = build(actionRow({ automatic: true }));
    const result = await service.propose({
      runId: RUN_ID,
      sessionId: 'session-1',
      messageId: 'message-1',
      userId: USER_ID,
      tool: tools.create,
      rawInput: { title: 'Смета' },
      automatic: true,
      authorization: 'Bearer user-token',
      ctx,
    });

    expect(executor.executeWrite).toHaveBeenCalledWith(
      tools.create,
      { title: 'Смета' },
      'Bearer user-token',
      ACTION_ID,
    );
    expect(result.text).toContain('выполнено');
    expect(bus.publish).toHaveBeenCalledWith(RUN_ID, 'action.executed', expect.anything());

    // Необратимое байпасом не исполняется: та же карточка ждёт человека (#926).
    const blocked = await service.propose({
      runId: RUN_ID,
      sessionId: 'session-1',
      messageId: 'message-1',
      userId: USER_ID,
      tool: findAnyTool('tasks.add_participant') as AssistantToolDefinition,
      rawInput: { taskId: RUN_ID, userId: USER_ID, role: 'observer' },
      automatic: true,
      authorization: 'Bearer user-token',
      ctx,
    });
    expect(blocked.text).toContain('необратимо');
    expect(executor.executeWrite).toHaveBeenCalledTimes(1);
  });
  it('лимит карточек за прогон и неверные аргументы — понятный отказ модели', async () => {
    const { service, repo } = build();
    repo.countRunActions.mockResolvedValueOnce(5);
    const overLimit = await service.propose({
      runId: RUN_ID,
      sessionId: 'session-1',
      messageId: null,
      userId: USER_ID,
      tool: tools.create,
      rawInput: { title: 'Смета' },
      automatic: false,
      authorization: 'Bearer user-token',
      ctx,
    });
    expect(overLimit.text).toContain('ASSISTANT_TOO_MANY_ACTIONS');
    expect(repo.createActionWithinLimit).not.toHaveBeenCalled();

    const invalid = await service.propose({
      runId: RUN_ID,
      sessionId: 'session-1',
      messageId: null,
      userId: USER_ID,
      tool: tools.create,
      rawInput: {},
      automatic: false,
      authorization: 'Bearer user-token',
      ctx,
    });
    expect(invalid.text).toContain('VALIDATION_FAILED');
  });
});

describe('AssistantActionsService: исполнение и отмена', () => {
  it('подтверждение выполняет карточку от имени сотрудника и пишет аудит', async () => {
    const { service, repo, executor, audit } = build();
    const result = await service.execute(USER_ID, ACTION_ID, 'Bearer user-token');

    expect(executor.executeWrite).toHaveBeenCalledWith(
      tools.create,
      { title: 'Смета' },
      'Bearer user-token',
      ACTION_ID,
    );
    expect(result.state).toBe('executed');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: USER_ID,
        action: 'assistant.action_execute',
        details: expect.objectContaining({ viaAi: true, automatic: false }),
      }),
    );
    expect(repo.finishAction).toHaveBeenCalledWith(
      ACTION_ID,
      expect.objectContaining({ state: 'executed', resultData: { id: 'task-1' } }),
    );
  });

  it('повторный клик «Выполнить» дубля не создаёт', async () => {
    const executed = actionRow({ state: 'executed' });
    const { service, executor } = build(executed);
    const result = await service.execute(USER_ID, ACTION_ID, 'Bearer user-token');
    expect(result.state).toBe('executed');
    expect(executor.executeWrite).not.toHaveBeenCalled();
  });

  it('чужая/несуществующая карточка — доменный 404', async () => {
    const { service, repo } = build();
    repo.findAction.mockResolvedValueOnce(null);
    await expect(service.execute(USER_ID, ACTION_ID, 'Bearer token')).rejects.toMatchObject({
      code: expect.stringContaining('NOT_FOUND'),
    });
  });

  it('отказ закрывает карточку без записей; выполненную отменить нельзя', async () => {
    const { service } = build();
    expect((await service.cancel(USER_ID, ACTION_ID)).state).toBe('cancelled');

    const executed = build(actionRow({ state: 'executed' }));
    await expect(executed.service.cancel(USER_ID, ACTION_ID)).rejects.toMatchObject({
      code: expect.stringContaining('CONFLICT'),
    });
  });

  it('«Отменить» после выполнения удаляет созданное; необратимое — 409', async () => {
    const { service, executor, repo } = build(
      actionRow({ state: 'executed', resultData: { id: 'task-1' } }),
    );
    const result = await service.undo(USER_ID, ACTION_ID, 'Bearer user-token');
    expect(executor.executeUndo).toHaveBeenCalledWith(
      { method: 'DELETE', path: '/tasks/task-1' },
      'Bearer user-token',
      `${ACTION_ID}:undo`,
    );
    expect(result.state).toBe('undone');
    expect(repo.finishAction).toHaveBeenCalledWith(
      ACTION_ID,
      expect.objectContaining({ state: 'undone', undoneAt: expect.any(Date) }),
    );

    const notUndoable = build(
      actionRow({ state: 'executed', toolId: 'tasks.update', undoable: false }),
    );
    await expect(
      notUndoable.service.undo(USER_ID, ACTION_ID, 'Bearer user-token'),
    ).rejects.toMatchObject({ code: expect.stringContaining('CONFLICT') });
  });

  it('сбой API: карточка в failed с кодом, повтор разрешён', async () => {
    const { service, repo, executor } = build();
    executor.executeWrite.mockResolvedValueOnce({
      ok: false as const,
      errorCode: 'FORBIDDEN',
      message: 'Недостаточно прав',
    });
    const failed = await service.execute(USER_ID, ACTION_ID, 'Bearer token');
    expect(failed.state).toBe('failed');
    expect(failed.errorCode).toBe('FORBIDDEN');
    expect(repo.finishAction).toHaveBeenCalledWith(
      ACTION_ID,
      expect.objectContaining({ state: 'failed', errorCode: 'FORBIDDEN' }),
    );
  });
});
