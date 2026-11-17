import { afterEach, describe, expect, it, vi } from 'vitest';

import { findTool, ALL_TOOLS } from './catalog.js';
import { ToolExecutorService } from './tool-executor.service.js';
import type { AssistantToolDefinition, ToolContext } from './tool-definition.js';

/**
 * Конвейер исполнения инструмента (#892, #896): путь `handler` (служебные) и
 * путь «инструмент → API портала» через Fastify inject от имени сотрудника.
 * Проверяем человеческие ошибки (403/404/сеть/таймаут) и то, что «Стоп»
 * рвёт запрос в API, а не оставляет его висеть.
 */

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    authorization: 'Bearer employee-token',
    screen: { moduleId: null, cardKind: null, cardId: null },
    signal: new AbortController().signal,
    available: ALL_TOOLS,
    activate: () => undefined,
    ...overrides,
  };
}

function makeExecutor(inject?: ReturnType<typeof vi.fn>) {
  const fastify = { inject: inject ?? vi.fn() };
  const adapterHost = { httpAdapter: { getInstance: () => fastify } };
  return { executor: new ToolExecutorService(adapterHost as never), fastify };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ToolExecutorService: инструмент → API портала (#892)', () => {
  it('успех: запрос идёт на /api/v1 с query, заголовком сотрудника и проекцией', async () => {
    const inject = vi.fn(async () => ({
      statusCode: 200,
      body: JSON.stringify({
        items: [{ id: '11111111-1111-4111-8111-111111111111', number: 1, title: 'Задача' }],
        nextCursor: null,
      }),
    }));
    const { executor } = makeExecutor(inject);
    const result = await executor.execute(
      findTool(ALL_TOOLS, 'tasks.list')!,
      { scope: 'mine', search: 'смета и цены', limit: 5 },
      context(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain('Задачи: 1');
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: '/api/v1/tasks?view=list&scope=mine&limit=5&search=%D1%81%D0%BC%D0%B5%D1%82%D0%B0%20%D0%B8%20%D1%86%D0%B5%D0%BD%D1%8B',
        headers: { authorization: 'Bearer employee-token', accept: 'application/json' },
      }),
    );
  });

  it('403 — понятная фраза о правах, а не сырой код', async () => {
    const inject = vi.fn(async () => ({
      statusCode: 403,
      body: JSON.stringify({ code: 'FORBIDDEN', message: 'forbidden' }),
    }));
    const { executor } = makeExecutor(inject);
    const result = await executor.execute(findTool(ALL_TOOLS, 'tasks.list')!, {}, context());
    expect(result).toEqual({
      ok: false,
      errorCode: 'FORBIDDEN',
      message: 'Недостаточно прав для этого действия (портал отклонил запрос)',
    });
  });

  it('доменный код ошибки API переводится человеческим текстом из contracts (I15)', async () => {
    const inject = vi.fn(async () => ({
      statusCode: 404,
      body: JSON.stringify({ code: 'NOT_FOUND', message: 'not found' }),
    }));
    const { executor } = makeExecutor(inject);
    const result = await executor.execute(
      findTool(ALL_TOOLS, 'tasks.get')!,
      { id: '11111111-1111-4111-8111-111111111111' },
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('NOT_FOUND');
      expect(result.message).toContain('не найден');
    }
  });

  it('неизвестный код и не-JSON тело — HTTP-статус и честный текст', async () => {
    const inject = vi.fn(async () => ({ statusCode: 500, body: '<html>сбой</html>' }));
    const { executor } = makeExecutor(inject);
    const result = await executor.execute(findTool(ALL_TOOLS, 'tasks.list')!, {}, context());
    expect(result).toEqual({
      ok: false,
      errorCode: 'HTTP_500',
      message: 'Ошибка API портала: запрос отклонён',
    });
  });

  it('нет HTTP-конвейера (юнит-окружение) — понятная ошибка, не падение', async () => {
    const executor = new ToolExecutorService({ httpAdapter: undefined } as never);
    const result = await executor.execute(findTool(ALL_TOOLS, 'tasks.list')!, {}, context());
    expect(result).toEqual({
      ok: false,
      errorCode: 'ASSISTANT_TOOL_INVALID',
      message: 'HTTP-конвейер недоступен',
    });
  });

  it('«Стоп» до старта — запрос в API не уходит', async () => {
    const inject = vi.fn();
    const { executor } = makeExecutor(inject);
    const controller = new AbortController();
    controller.abort();
    const result = await executor.execute(
      findTool(ALL_TOOLS, 'tasks.list')!,
      {},
      context({ signal: controller.signal }),
    );
    expect(result).toEqual({
      ok: false,
      errorCode: 'ASSISTANT_TOOL_ABORTED',
      message: 'Прогон остановлен',
    });
    expect(inject).not.toHaveBeenCalled();
  });

  it('«Стоп» во время запроса — запрос обрывается, исход — остановка прогона', async () => {
    const inject = vi.fn(() => new Promise(() => undefined));
    const { executor } = makeExecutor(inject);
    const controller = new AbortController();
    const running = executor.execute(
      findTool(ALL_TOOLS, 'tasks.list')!,
      {},
      context({ signal: controller.signal }),
    );
    controller.abort();
    const result = await running;
    expect(result).toEqual({
      ok: false,
      errorCode: 'ASSISTANT_TOOL_ABORTED',
      message: 'Прогон остановлен',
    });
    // Запрос получил тот же сигнал отмены — провайдер/API не работают вхолостую.
    expect((inject.mock.calls[0] as unknown as [{ signal: AbortSignal }])[0].signal.aborted).toBe(
      true,
    );
  });

  it('inject выбросил исключение — остановка, а не 500 наружу', async () => {
    const inject = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const { executor } = makeExecutor(inject);
    const result = await executor.execute(findTool(ALL_TOOLS, 'tasks.list')!, {}, context());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('ASSISTANT_TOOL_ABORTED');
  });

  it('зависший запрос закрывается таймаутом с понятной ошибкой', async () => {
    vi.useFakeTimers();
    const inject = vi.fn(() => new Promise(() => undefined));
    const { executor } = makeExecutor(inject);
    const running = executor.execute(findTool(ALL_TOOLS, 'tasks.list')!, {}, context());
    await vi.advanceTimersByTimeAsync(20_001);
    const result = await running;
    expect(result).toEqual({
      ok: false,
      errorCode: 'ASSISTANT_TOOL_TIMEOUT',
      message: 'Действие не ответило вовремя',
    });
  });

  it('инструмент без handler/api — «не исполним»', async () => {
    const { executor } = makeExecutor(vi.fn());
    const broken: AssistantToolDefinition = {
      ...findTool(ALL_TOOLS, 'tasks.list')!,
      api: undefined,
      build: undefined,
      project: undefined,
    };
    const result = await executor.execute(broken, {}, context());
    expect(result).toEqual({
      ok: false,
      errorCode: 'ASSISTANT_TOOL_INVALID',
      message: 'Инструмент не исполним',
    });
  });
});

describe('ToolExecutorService: вычислимые инструменты (#892)', () => {
  it('handler выполняется, текст финализируется, сущность передаётся', async () => {
    const { executor } = makeExecutor(vi.fn());
    const result = await executor.execute(
      findTool(ALL_TOOLS, 'ui.open_entity')!,
      { kind: 'task', id: '11111111-1111-4111-8111-111111111111' },
      context(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain('Ссылка на карточку готова');
      expect(result.entity?.href).toContain('?cards=task:');
    }
  });

  it('отмена сразу после handler не отдаёт модельный результат', async () => {
    const controller = new AbortController();
    const { executor } = makeExecutor(vi.fn());
    const tool: AssistantToolDefinition = {
      ...findTool(ALL_TOOLS, 'context.get')!,
      handler: async () => {
        controller.abort();
        return { text: 'поздний ответ' };
      },
    };
    const result = await executor.execute(tool, {}, context({ signal: controller.signal }));
    expect(result).toEqual({
      ok: false,
      errorCode: 'ASSISTANT_TOOL_ABORTED',
      message: 'Прогон остановлен',
    });
  });
});
