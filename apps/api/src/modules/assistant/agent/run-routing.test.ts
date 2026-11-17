import { describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';

import type { AiSettingsService } from '../providers/ai-settings.service.js';
import type { LlmMessage, LlmProvider } from '../providers/llm-provider.port.js';
import type { RunBusService } from '../run-bus.service.js';
import { ALL_TOOLS } from '../tools/catalog.js';
import { continuationPrompt, lastUserPrompt, routeTools, routedToolsOf } from './run-routing.js';

/**
 * Маршрутизация прогона (#917): диспетчер выбирает инструменты до основного
 * цикла, а любой сбой (нет настройки, таймаут, мусор) — горячая полка без
 * падения прогона. Здесь — решения обвязки, а не качество промпта.
 */

const SCREEN = { moduleId: 'tasks', cardKind: null, cardId: null };

type RouterStub = { providerId: string; modelId: string; provider: LlmProvider };

function makeDeps(
  overrides: {
    router?: RouterStub | null;
    stream?: () => AsyncIterable<{ type: string; text?: string }>;
  } = {},
) {
  const bus = { publish: vi.fn(async () => undefined) } as unknown as RunBusService;
  const logger = { warn: vi.fn(), error: vi.fn(), setContext: vi.fn() } as unknown as PinoLogger;
  const router: RouterStub | null =
    overrides.router === undefined
      ? {
          providerId: 'p1',
          modelId: 'router-model',
          provider: {
            streamChat:
              overrides.stream ??
              async function* () {
                yield {
                  type: 'text.delta',
                  text: JSON.stringify({ tools: [{ id: 'tasks.list', score: 0.9 }] }),
                };
              },
          } as unknown as LlmProvider,
        }
      : overrides.router;
  const settings = {
    resolveRouter: vi.fn(async () => router),
  } as unknown as AiSettingsService;
  return { settings, bus, logger };
}

function call(
  deps: ReturnType<typeof makeDeps>,
  options: { continuation?: boolean; signal?: AbortSignal; messages?: LlmMessage[] } = {},
) {
  return routeTools({
    runId: 'run-1',
    screen: SCREEN,
    continuation: options.continuation ?? false,
    catalog: ALL_TOOLS,
    priorMessages: options.messages ?? [{ role: 'user', content: 'заверши задачу №165' }],
    signal: options.signal ?? new AbortController().signal,
    settings: deps.settings,
    bus: deps.bus,
    logger: deps.logger,
  });
}

describe('routeTools: диспетчер и запасной путь (#917)', () => {
  it('без модели-диспетчера — пусто, горячая полка остаётся', async () => {
    const deps = makeDeps({ router: null });
    await expect(call(deps)).resolves.toEqual([]);
    expect(deps.bus.publish).not.toHaveBeenCalled();
  });

  it('продолжение не роутится: диспетчер не спрашивает модель', async () => {
    const deps = makeDeps();
    await expect(call(deps, { continuation: true })).resolves.toEqual([]);
    expect(deps.settings.resolveRouter).not.toHaveBeenCalled();
  });

  it('успех: id из каталога и событие tools.routed с моделью', async () => {
    const deps = makeDeps();
    const routed = await call(deps);
    expect(routed).toEqual([{ id: 'tasks.list', score: 0.9 }]);
    expect(deps.bus.publish).toHaveBeenCalledWith(
      'run-1',
      'tools.routed',
      expect.objectContaining({ model: 'router-model', fallback: false }),
    );
  });

  it('сбой диспетчера — fallback: true и пустой выбор, без исключения', async () => {
    const deps = makeDeps({
      stream: async function* () {
        yield { type: 'text.delta', text: '' };
        throw new Error('router exploded');
      },
    });
    await expect(call(deps)).resolves.toEqual([]);
    expect(deps.bus.publish).toHaveBeenCalledWith(
      'run-1',
      'tools.routed',
      expect.objectContaining({ fallback: true, tools: [] }),
    );
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('отмена прогона не пишет fallback-событие', async () => {
    const controller = new AbortController();
    const deps = makeDeps({
      stream: async function* () {
        yield { type: 'text.delta', text: '' };
        controller.abort();
        throw new Error('aborted');
      },
    });
    await expect(call(deps, { signal: controller.signal })).resolves.toEqual([]);
    expect(deps.bus.publish).not.toHaveBeenCalled();
  });
});

describe('lastUserPrompt / routedToolsOf / continuationPrompt', () => {
  it('берёт последний строковый вопрос сотрудника', () => {
    expect(
      lastUserPrompt([
        { role: 'user', content: 'первый' },
        { role: 'assistant', content: 'ответ' },
        { role: 'user', content: 'второй' },
      ]),
    ).toBe('второй');
    expect(lastUserPrompt([{ role: 'assistant', content: 'ответ' }])).toBe('');
  });

  it('routedToolsOf сохраняет порядок диспетчера и пропускает неизвестные', () => {
    const tools = routedToolsOf(ALL_TOOLS, [
      { id: 'tasks.transitions', score: 0.9 },
      { id: 'ghost.tool', score: 0.8 },
      { id: 'tasks.list', score: 0.7 },
    ]);
    expect(tools.map((tool) => tool.id)).toEqual(['tasks.transitions', 'tasks.list']);
  });

  it('continuationPrompt упоминает ожидающие карточки только когда они есть', () => {
    const base = continuationPrompt({ ofMessageId: 'm-1', pendingCards: 0 });
    expect(base).toContain('Подведи короткий итог');
    expect(base).not.toContain('ждут решения');
    expect(continuationPrompt({ ofMessageId: 'm-1', pendingCards: 2 })).toContain('Ещё 2 карточек');
  });
});
