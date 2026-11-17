import { describe, expect, it } from 'vitest';

import { ALL_TOOLS, findTool } from './catalog.js';
import { searchTools } from './search.js';
import { toLlmTool } from './tool-schema.js';
import { ToolExecutorService } from './tool-executor.service.js';
import type { ToolContext } from './tool-definition.js';

/**
 * Поиск по каталогу, схема для модели и read-only предохранитель исполнителя
 * (#892). Проверяем то, что не видно типам: что модель получит осмысленную
 * схему аргументов, а запись не пройдёт даже прямым вызовом по имени.
 */

describe('searchTools (лексический поиск, вторая полка)', () => {
  it('находит историю задачи по словам сотрудника', () => {
    const found = searchTools(ALL_TOOLS, 'история задачи кто менял');
    expect(found[0]?.id).toBe('tasks.history');
  });

  it('находит вложения письма и оргструктуру', () => {
    expect(searchTools(ALL_TOOLS, 'вложения письма')[0]?.id).toBe('letters.attachments');
    expect(searchTools(ALL_TOOLS, 'оргструктура отделы')[0]?.id).toBe('directory.departments');
  });

  it('пустой и мусорный запрос — пустой результат, без случайных подсказок', () => {
    expect(searchTools(ALL_TOOLS, '')).toEqual([]);
    expect(searchTools(ALL_TOOLS, '   ?! ')).toEqual([]);
    expect(searchTools(ALL_TOOLS, 'zzz-nonexistent')).toEqual([]);
  });

  it('лимит соблюдается и порядок детерминирован', () => {
    const first = searchTools(ALL_TOOLS, 'задачи список', 2);
    const second = searchTools(ALL_TOOLS, 'задачи список', 2);
    expect(first).toHaveLength(2);
    expect(first.map((tool) => tool.id)).toEqual(second.map((tool) => tool.id));
  });
});

describe('toLlmTool (схема аргументов из zod)', () => {
  it('отдаёт имя, описание и объектную JSON Schema без $schema', () => {
    const tool = findTool(ALL_TOOLS, 'tasks.list');
    expect(tool).not.toBeNull();
    const llm = toLlmTool(tool!);
    expect(llm.function.name).toBe('tasks.list');
    expect(llm.function.description.length).toBeGreaterThan(20);
    expect(llm.function.parameters.type).toBe('object');
    expect(llm.function.parameters).not.toHaveProperty('$schema');
    expect(Object.keys(llm.function.parameters.properties ?? {})).toContain('scope');
  });

  it('у инструмента без аргументов — пустая объектная схема', () => {
    const llm = toLlmTool(findTool(ALL_TOOLS, 'context.get')!);
    expect(llm.function.parameters).toEqual({ type: 'object', properties: {} });
  });
});

describe('ToolExecutorService: предохранители', () => {
  const ctx: ToolContext = {
    authorization: 'Bearer test',
    screen: { moduleId: null, cardKind: null, cardId: null },
    signal: new AbortController().signal,
    available: ALL_TOOLS,
    activate: () => undefined,
  };

  it('инструмент записи не исполняется даже при прямом вызове по имени', async () => {
    const executor = new ToolExecutorService({ httpAdapter: undefined } as never);
    const writeTool = { ...findTool(ALL_TOOLS, 'tasks.list')!, kind: 'write' as const };
    const result = await executor.execute(writeTool, {}, ctx);
    expect(result).toEqual({
      ok: false,
      errorCode: 'ASSISTANT_READ_ONLY',
      message: 'В этом режиме доступно только чтение',
    });
  });

  it('неверные аргументы возвращают понятную ошибку, а не падение', async () => {
    const executor = new ToolExecutorService({ httpAdapter: undefined } as never);
    const result = await executor.execute(
      findTool(ALL_TOOLS, 'tasks.get')!,
      { id: 'не-uuid' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('VALIDATION_FAILED');
  });
});
