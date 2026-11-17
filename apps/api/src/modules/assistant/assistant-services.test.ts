import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { AssistantSessionsService, normalizeScreenContext } from './assistant-sessions.service.js';
import { AssistantRunsService } from './assistant-runs.service.js';
import type { MessageRow, RunRow, SessionRow } from './assistant.repository.js';
import { DomainException } from '../../core/errors/domain-exception.js';

/**
 * Сервисы сессий и прогонов (#893, #896): владение диалогом (чужая — 404),
 * отказ отправки в архив, контекст экрана без доверия клиенту, отмена живого
 * и «зависшего» прогона.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-17T10:00:00.000Z');

const user: AuthUser = {
  id: USER_ID,
  email: 'ivanov@nodus.by',
  displayName: 'Иванов Иван',
  permissions: ['assistant.use'],
};

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    title: '',
    archivedAt: null,
    lastMessageAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    messageCount: 0,
    ...overrides,
  };
}

function messageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: MESSAGE_ID,
    sessionId: SESSION_ID,
    runId: RUN_ID,
    role: 'assistant',
    text: 'Ответ',
    reasoning: null,
    errorCode: null,
    createdAt: NOW,
    runStatus: 'running',
    toolCalls: [],
    ...overrides,
  };
}

function runRow(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: RUN_ID,
    sessionId: SESSION_ID,
    userId: USER_ID,
    status: 'running',
    providerId: null,
    modelId: 'm1',
    inputTokens: null,
    outputTokens: null,
    errorCode: null,
    errorMessage: null,
    startedAt: NOW,
    finishedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

describe('normalizeScreenContext: не доверяем форме клиента (#893)', () => {
  it('контекст без карточки и корректный раздел', () => {
    expect(normalizeScreenContext()).toEqual({ moduleId: null, cardKind: null, cardId: null });
    expect(normalizeScreenContext({ moduleId: 'tasks' })).toEqual({
      moduleId: 'tasks',
      cardKind: null,
      cardId: null,
    });
  });

  it('мусорный раздел отбрасывается, карточка — только с видом и id', () => {
    expect(normalizeScreenContext({ moduleId: 'Задачи!' }).moduleId).toBeNull();
    expect(
      normalizeScreenContext({ moduleId: 'tasks', cardKind: 'task', cardId: 'abc' }),
    ).toMatchObject({ cardKind: 'task', cardId: 'abc' });
    expect(normalizeScreenContext({ cardKind: 'task' }).cardKind).toBeNull();
    expect(normalizeScreenContext({ cardId: 'abc' }).cardId).toBeNull();
  });
});

describe('AssistantSessionsService (#893)', () => {
  function makeService(session: SessionRow | null = sessionRow()) {
    const repo = {
      listSessions: vi.fn(async () => [sessionRow({ title: 'Задачи', messageCount: 2 })]),
      createSession: vi.fn(async () => sessionRow({ title: 'Новый' })),
      updateSession: vi.fn(async () => session ?? null),
      findSession: vi.fn(async () => session),
      listMessages: vi.fn(async () => [messageRow()]),
      createRun: vi.fn(async () => undefined),
      createMessage: vi.fn(async () => messageRow({ role: 'user', createdAt: NOW })),
      touchSession: vi.fn(async () => undefined),
    };
    const runner = { start: vi.fn() };
    const flags = { enabledModules: vi.fn(async () => ['tasks', 'chat']) };
    const service = new AssistantSessionsService(repo as never, runner as never, flags as never);
    return { service, repo, runner, flags };
  }

  it('list отдаёт диалоги без курсора (лимит сессий — серверный)', async () => {
    const { service } = makeService();
    const list = await service.list(user);
    expect(list.nextCursor).toBeNull();
    expect(list.items[0]).toMatchObject({ title: 'Задачи', messageCount: 2 });
  });

  it('create обрезает заголовок и передаёт его в репозиторий', async () => {
    const { service, repo } = makeService();
    const created = await service.create(user, { title: '  Смета  ' });
    expect(repo.createSession).toHaveBeenCalledWith(USER_ID, 'Смета');
    expect(created.title).toBe('Новый');
    await service.create(user, {});
    expect(repo.createSession).toHaveBeenLastCalledWith(USER_ID, '');
  });

  it('update: чужая/несуществующая сессия — доменный 404', async () => {
    const { service } = makeService(null);
    await expect(service.update(user, SESSION_ID, { title: 'x' })).rejects.toMatchObject({
      code: expect.stringContaining('NOT_FOUND'),
    });
  });

  it('messages: чужая сессия — 404, своя — история с вызовами', async () => {
    const { service, repo } = makeService();
    const history = await service.messages(user, SESSION_ID);
    expect(history.items).toHaveLength(1);
    expect(repo.listMessages).toHaveBeenCalledWith(SESSION_ID, 200);

    const missing = makeService(null);
    await expect(missing.service.messages(user, SESSION_ID)).rejects.toBeInstanceOf(
      DomainException,
    );
  });

  it('sendMessage: архивный диалог — 409, отправка недоступна', async () => {
    const { service, repo } = makeService(sessionRow({ archivedAt: NOW }));
    await expect(
      service.sendMessage(user, SESSION_ID, { text: 'Привет' }, 'Bearer token'),
    ).rejects.toMatchObject({ code: expect.stringContaining('CONFLICT') });
    expect(repo.createRun).not.toHaveBeenCalled();
  });

  it('sendMessage: создаёт прогон и вопрос, запускает агента с токеном сотрудника', async () => {
    const { service, repo, runner, flags } = makeService();
    const response = await service.sendMessage(
      user,
      SESSION_ID,
      { text: '  Какие задачи просрочены?  ', context: { moduleId: 'tasks' } },
      'Bearer token',
    );
    expect(response.runId).toBeTruthy();
    expect(response.messageId).toBe(MESSAGE_ID);
    expect(repo.createRun).toHaveBeenCalledWith({
      id: response.runId,
      sessionId: SESSION_ID,
      userId: USER_ID,
      providerId: null,
      modelId: null,
    });
    expect(repo.createMessage).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      runId: response.runId,
      role: 'user',
      text: 'Какие задачи просрочены?',
    });
    // Заголовок из первого вопроса: пустая сессия получает его.
    expect(repo.touchSession).toHaveBeenCalledWith(SESSION_ID, NOW, 'Какие задачи просрочены?');
    expect(runner.start).toHaveBeenCalledWith({
      runId: response.runId,
      sessionId: SESSION_ID,
      userId: USER_ID,
      authorization: 'Bearer token',
      permissions: ['assistant.use'],
      features: ['tasks', 'chat'],
      screen: { moduleId: 'tasks', cardKind: null, cardId: null },
    });
    expect(flags.enabledModules).toHaveBeenCalled();
  });

  it('sendMessage: у сессии уже есть заголовок — не перезаписываем', async () => {
    const { service, repo } = makeService(sessionRow({ title: 'Мои задачи' }));
    await service.sendMessage(user, SESSION_ID, { text: 'Ещё вопрос' }, 'Bearer token');
    expect(repo.touchSession).toHaveBeenCalledWith(SESSION_ID, NOW, undefined);
  });

  it('sendMessage: длинный первый вопрос обрезается до 80 знаков', async () => {
    const { service, repo } = makeService();
    await service.sendMessage(user, SESSION_ID, { text: 'слово '.repeat(40) }, 'Bearer token');
    const title = (repo.touchSession as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    expect(title.length).toBe(78);
    expect(title.endsWith('…')).toBe(true);
  });

  it('sendMessage: чужой диалог — 404 до создания прогона', async () => {
    const { service, repo } = makeService(null);
    await expect(
      service.sendMessage(user, SESSION_ID, { text: 'x' }, 'Bearer token'),
    ).rejects.toMatchObject({ code: expect.stringContaining('NOT_FOUND') });
    expect(repo.createRun).not.toHaveBeenCalled();
  });
});

describe('AssistantRunsService (#893)', () => {
  function makeService(run: RunRow | null = runRow()) {
    const repo = {
      findRun: vi.fn(async () => run),
      updateRun: vi.fn(async () => undefined),
    };
    const bus = { stream: vi.fn(() => ({ pipe: vi.fn(() => 'stream') })) };
    const runner = { cancel: vi.fn(() => true) };
    const service = new AssistantRunsService(repo as never, bus as never, runner as never);
    return { service, repo, bus, runner };
  }

  it('get: прогон владельца, иначе 404', async () => {
    const { service } = makeService();
    expect((await service.get(user, RUN_ID)).id).toBe(RUN_ID);
    const missing = makeService(null);
    await expect(missing.service.get(user, RUN_ID)).rejects.toMatchObject({
      code: expect.stringContaining('NOT_FOUND'),
    });
  });

  it('stream: нормализует Last-Event-ID (NaN и отрицательный → 0)', async () => {
    const { service, bus } = makeService();
    await service.stream(user, RUN_ID, Number.NaN);
    expect(bus.stream).toHaveBeenCalledWith(RUN_ID, 0, { terminal: false });
    await service.stream(user, RUN_ID, -5);
    expect(bus.stream).toHaveBeenLastCalledWith(RUN_ID, 0, { terminal: false });
    await service.stream(user, RUN_ID, 42);
    expect(bus.stream).toHaveBeenLastCalledWith(RUN_ID, 42, { terminal: false });
  });

  it('stream: завершённый прогон отдаёт журнал как терминальный', async () => {
    const { service, bus } = makeService(runRow({ status: 'completed' }));
    await service.stream(user, RUN_ID, 0);
    expect(bus.stream).toHaveBeenCalledWith(RUN_ID, 0, { terminal: true });
  });

  it('stream: чужой прогон — 404 до открытия потока', async () => {
    const { service, bus } = makeService(null);
    await expect(service.stream(user, RUN_ID, 0)).rejects.toMatchObject({
      code: expect.stringContaining('NOT_FOUND'),
    });
    expect(bus.stream).not.toHaveBeenCalled();
  });

  it('cancel: завершённый прогон — 409 ASSISTANT_RUN_ALREADY_FINISHED', async () => {
    const { service, runner } = makeService(runRow({ status: 'failed' }));
    await expect(service.cancel(user, RUN_ID)).rejects.toMatchObject({
      code: expect.stringContaining('ALREADY_FINISHED'),
    });
    expect(runner.cancel).not.toHaveBeenCalled();
  });

  it('cancel: живой прогон останавливает раннер и перечитывает статус', async () => {
    const { service, repo, runner } = makeService();
    repo.findRun
      .mockResolvedValueOnce(runRow())
      .mockResolvedValueOnce(runRow({ status: 'cancelled' }));
    const result = await service.cancel(user, RUN_ID);
    expect(runner.cancel).toHaveBeenCalledWith(RUN_ID);
    expect(repo.updateRun).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
  });

  it('cancel: прогона нет в памяти — закрывает запись в БД', async () => {
    const { service, repo, runner } = makeService();
    runner.cancel.mockReturnValueOnce(false);
    repo.findRun
      .mockResolvedValueOnce(runRow())
      .mockResolvedValueOnce(runRow({ status: 'cancelled' }));
    await service.cancel(user, RUN_ID);
    expect(repo.updateRun).toHaveBeenCalledWith(RUN_ID, {
      status: 'cancelled',
      finishedAt: expect.any(Date),
      errorCode: 'cancelled',
      errorMessage: 'Прогон остановлен сотрудником',
    });
  });

  it('cancel: перечитывание не удалось — отдаёт прежнюю строку', async () => {
    const { service, repo } = makeService();
    repo.findRun.mockResolvedValueOnce(runRow()).mockResolvedValueOnce(null);
    const result = await service.cancel(user, RUN_ID);
    expect(result.id).toBe(RUN_ID);
  });
});
