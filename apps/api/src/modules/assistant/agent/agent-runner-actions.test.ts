import { describe, expect, it } from 'vitest';

import type { RunEvent } from '../run-bus.service.js';
import { build, drain, params } from './fixtures/runner-harness.js';

/**
 * Запись в агентном цикле (Ф2, #899, ADR-0048): `kind: write` НЕ исполняется
 * прямым вызовом API — только карточкой подтверждения. Байпас прогона —
 * единственный обход, и он фиксируется флагом `automatic` на карточке.
 * Память сотрудника подставляется в системный промпт (#900).
 */

const createCall = {
  type: 'tool_call' as const,
  call: {
    id: 'call_create',
    type: 'function' as const,
    function: { name: 'tasks.create', arguments: '{"title":"Проверить смету"}' },
  },
};

const taskParams = {
  ...params,
  permissions: ['assistant.use', 'task.create'],
  features: ['tasks', 'projects', 'correspondence', 'chat'],
};

describe('AgentRunnerService: действия (Ф2)', () => {
  it('без байпаса действие идёт в карточку, а не в API портала', async () => {
    const { runner, bus, fake, executor, actions } = build([
      [createCall, { type: 'done', finishReason: 'tool_calls' }],
      [
        { type: 'text.delta', text: 'Подготовил карточку.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const streamDone = drain(bus);
    runner.start(taskParams);
    const events = await streamDone;

    expect(executor.execute).not.toHaveBeenCalled();
    expect(actions.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: expect.objectContaining({ id: 'tasks.create' }),
        automatic: false,
        userId: taskParams.userId,
      }),
    );
    // Строка инструмента не дублирует карточку: tool.started для записи не пишется.
    const toolStarted = (events as RunEvent[]).filter((event) => event.type === 'tool.started');
    expect(toolStarted).toEqual([]);
    expect(fake.messages.at(-1)?.text).toContain('Подготовил карточку');
  });

  it('байпас прогона исполняет действие сразу (automatic=true)', async () => {
    const { runner, bus, actions } = build([
      [createCall, { type: 'done', finishReason: 'tool_calls' }],
      [
        { type: 'text.delta', text: 'Готово.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const streamDone = drain(bus);
    runner.start({ ...taskParams, autoExecute: true });
    await streamDone;

    expect(actions.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        automatic: true,
        tool: expect.objectContaining({ id: 'tasks.create' }),
      }),
    );
  });

  it('чтение по-прежнему исполняется сразу и даёт строку вызова', async () => {
    const { runner, bus, executor, actions } = build([
      [
        {
          type: 'tool_call',
          call: {
            id: 'call_list',
            type: 'function',
            function: { name: 'tasks.list', arguments: '{"scope":"mine"}' },
          },
        },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text.delta', text: 'Ответ.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    const streamDone = drain(bus);
    runner.start(taskParams);
    await streamDone;

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(actions.propose).not.toHaveBeenCalled();
  });
});

describe('AgentRunnerService: память сотрудника (#900)', () => {
  it('активные записи блокнота уходят в системный промпт', async () => {
    const { runner, bus, memory, requests } = build([
      [
        { type: 'text.delta', text: 'Учту.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);
    memory.promptLines.mockResolvedValueOnce(['Отчёты — по пятницам']);
    const streamDone = drain(bus);
    runner.start(taskParams);
    await streamDone;

    const system = requests[0]?.messages[0];
    expect(system?.role).toBe('system');
    expect(String(system?.content)).toContain('Память сотрудника');
    expect(String(system?.content)).toContain('Отчёты — по пятницам');
    expect(memory.port).toHaveBeenCalledWith(taskParams.userId, taskParams.runId);
  });
});
