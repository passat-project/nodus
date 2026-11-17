import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../tool-definition.js';
import { findAnyTool } from '../catalog.js';
import { parseToolInput } from '../tool-executor.service.js';

/**
 * Действия Ф2 (#899, ADR-0048): карточка «что будет сделано» собирается из
 * РЕАЛЬНЫХ данных портала (имя вместо id), undo указывает на удаление
 * созданного, тело мутации — ровно поля инструмента.
 */

const U = '44444444-4444-4444-8444-444444444444';
const P = '55555555-5555-4555-8555-555555555555';
const T = '66666666-6666-4666-8666-666666666666';
const L = '77777777-7777-4777-8777-777777777777';
const TR = '88888888-8888-4888-8888-888888888888';

const ctx: ToolContext = {
  authorization: 'Bearer t',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  read: vi.fn(async (path: string) => {
    if (path === `/directory/users/${U}`) return { id: U, displayName: 'Иванов Иван' };
    if (path === `/projects/${P}`) return { id: P, name: 'Смета-2026' };
    if (path === `/tasks/${T}`)
      return { id: T, number: 42, title: 'Проверить смету', stage: { name: 'В работе' } };
    if (path === '/tasks/stages?scope=all') return [{ id: 'stage-1', name: 'Проверка' }];
    if (path === `/letters/${L}`) return { id: L, number: '12/26', subject: 'Письмо от банка' };
    if (path === `/letters/${L}/transitions`)
      return [{ id: TR, name: 'Дать резолюцию', toStageName: 'В работе' }];
    return null;
  }),
};

function card(toolId: string) {
  const tool = findAnyTool(toolId);
  expect(tool, toolId).toBeTruthy();
  expect(tool!.card, `${toolId}: карточка обязательна`).toBeTruthy();
  return tool!;
}

describe('карточки действий: имена и последствия', () => {
  it('tasks.create: название, проект и исполнитель именами; undo удаляет задачу', async () => {
    const tool = card('tasks.create');
    const input = { title: 'Проверить смету', projectId: P, assigneeId: U };
    const summary = await tool.card!.summary(input, ctx);
    expect(summary).toBe('Задача «Проверить смету» в проекте «Смета-2026»');
    const fields = await tool.card!.fields(input, ctx);
    expect(fields.map((field) => field.value)).toEqual(
      expect.arrayContaining(['Проверить смету', 'Смета-2026', 'Иванов Иван']),
    );
    expect(tool.card!.undo!(input, { id: T })).toEqual({ method: 'DELETE', path: `/tasks/${T}` });
    expect(tool.card!.consequences).toContain('Отменить');
  });

  it('tasks.update: карточка показывает задачу из портала, а не слова модели', async () => {
    const tool = card('tasks.update');
    const input = { id: T, stageId: 'stage-1' };
    await expect(tool.card!.summary(input, ctx)).resolves.toContain('Проверить смету');
    const fields = await tool.card!.fields(input, ctx);
    expect(fields.map((field) => field.value)).toEqual(
      expect.arrayContaining(['№42 «Проверить смету»', 'Проверка']),
    );
    // Автоматической отмены правки нет — карточка честно предупреждает.
    expect(tool.card!.undo).toBeUndefined();
    expect(tool.card!.consequences).toContain('отмены нет');
  });

  it('chat.send: отмена удаляет именно отправленное сообщение беседы', () => {
    const tool = card('chat.send');
    expect(tool.card!.undo!({ conversationId: P }, { id: T })).toEqual({
      method: 'DELETE',
      path: `/chat/conversations/${P}/messages/${T}`,
    });
  });

  it('letters.transition: резолюция показывает переход и целевую стадию', async () => {
    const tool = card('letters.transition');
    const input = { letterId: L, transitionId: TR, description: 'Разобраться' };
    const summary = await tool.card!.summary(input, ctx);
    expect(summary).toBe('Дать резолюцию: письмо №12/26 «Письмо от банка» → «В работе»');
    const fields = await tool.card!.fields(input, ctx);
    expect(fields.map((field) => field.value)).toEqual(
      expect.arrayContaining(['№12/26 «Письмо от банка»', 'Дать резолюцию', 'В работе']),
    );
    expect(tool.card!.undo).toBeUndefined();
  });

  it('projects.add_member и add_node: undo возвращает состав/структуру', () => {
    const member = card('projects.add_member');
    expect(member.card!.undo!({ id: P, userId: U }, {})).toEqual({
      method: 'DELETE',
      path: `/projects/${P}/members/${U}`,
    });
    const node = card('projects.add_node');
    expect(node.card!.undo!({ id: P }, { id: T })).toEqual({
      method: 'DELETE',
      path: `/projects/${P}/nodes/${T}`,
    });
  });
});

describe('тела мутаций: ровно переданные поля', () => {
  it('tasks.create → POST /tasks только с заполненными полями', () => {
    const tool = card('tasks.create');
    const parsed = parseToolInput(tool, { title: ' Смета ', projectId: P });
    expect(parsed.ok).toBe(true);
    const request = tool.build!(parsed.ok ? parsed.input : {});
    expect(request).toEqual({
      method: 'POST',
      path: '/tasks',
      body: { title: 'Смета', projectId: P },
    });
  });

  it('tasks.update → PATCH /tasks/:id; null срока передаётся (убрать срок)', () => {
    const tool = card('tasks.update');
    const parsed = parseToolInput(tool, { id: T, deadline: null });
    expect(parsed.ok).toBe(true);
    expect(tool.build!(parsed.ok ? parsed.input : {})).toEqual({
      method: 'PATCH',
      path: `/tasks/${T}`,
      body: { deadline: null },
    });
  });

  it('letters.transition → форма окна из полей резолюции', () => {
    const tool = card('letters.transition');
    const parsed = parseToolInput(tool, {
      letterId: L,
      transitionId: TR,
      assigneeId: U,
      description: 'Разобраться',
    });
    expect(parsed.ok).toBe(true);
    expect(tool.build!(parsed.ok ? parsed.input : {})).toMatchObject({
      method: 'POST',
      path: `/letters/${L}/transitions/${TR}`,
      body: { form: { fields: { description: 'Разобраться', assigneeId: U } } },
    });
  });

  it('projects.add_node → POST /projects/:id/nodes без пустого родителя', () => {
    const tool = card('projects.add_node');
    const parsed = parseToolInput(tool, { id: P, name: 'Корпус 1', kindId: T });
    expect(parsed.ok).toBe(true);
    expect(tool.build!(parsed.ok ? parsed.input : {})).toEqual({
      method: 'POST',
      path: `/projects/${P}/nodes`,
      body: { name: 'Корпус 1', kindId: T },
    });
  });
});
