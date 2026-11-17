import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../tool-definition.js';
import { findAnyTool } from '../catalog.js';

/**
 * Инструменты блокнота (#900): запись без подтверждения (это личная память
 * агента, не данные портала), список с id и удаление. Без порта памяти —
 * честный отказ, а не падение.
 */

const ctx: ToolContext = {
  authorization: 'Bearer t',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  memory: {
    save: vi.fn(async (text: string) => ({ id: 'm-1', text, duplicate: false })),
    list: vi.fn(async () => [
      { id: 'm-1', text: 'Отчёты — по пятницам' },
      { id: 'm-2', text: 'Отвечаю за проекты Смета' },
    ]),
    forget: vi.fn(async (id: string) => id === 'm-1'),
  },
};

function handler(id: string) {
  const tool = findAnyTool(id);
  expect(tool?.handler, id).toBeTruthy();
  return tool!.handler!;
}

describe('memory.save / list / forget (#900)', () => {
  it('save записывает и сообщает модели результат', async () => {
    const result = await handler('memory.save')({ text: 'Отчёты — по пятницам' }, ctx);
    expect(result.text).toBe('Записано в блокнот: Отчёты — по пятницам');
    await expect(
      handler('memory.save')({ text: 'x' }, { ...ctx, memory: undefined }),
    ).resolves.toEqual({ text: 'Блокнот недоступен в этом режиме' });
  });

  it('save дубля говорит «уже записано»', async () => {
    const duplicateCtx = {
      ...ctx,
      memory: {
        ...ctx.memory!,
        save: vi.fn(async (text: string) => ({ id: 'm-1', text, duplicate: true })),
      },
    };
    const result = await handler('memory.save')({ text: 'Отчёты — по пятницам' }, duplicateCtx);
    expect(result.text).toContain('Уже записано');
  });

  it('list отдаёт записи с id, пустой блокнот — честно', async () => {
    const result = await handler('memory.list')({}, ctx);
    expect(result.text).toContain('Отчёты — по пятницам');
    expect(result.text).toContain('id m-1');
    const empty = await handler('memory.list')(
      {},
      {
        ...ctx,
        memory: { ...ctx.memory!, list: vi.fn(async () => []) },
      },
    );
    expect(empty.text).toBe('Блокнот пуст');
  });

  it('forget удаляет по id; неизвестный — «не найдена»', async () => {
    await expect(handler('memory.forget')({ id: 'm-1' }, ctx)).resolves.toEqual({
      text: 'Запись удалена из блокнота',
    });
    await expect(
      handler('memory.forget')({ id: '99999999-9999-4999-8999-999999999999' }, ctx),
    ).resolves.toEqual({ text: 'Запись не найдена' });
  });
});
