import { describe, expect, it, vi } from 'vitest';
import type { Paginated, TaskRelation } from '@nodus/contracts';
import type { ToolContext } from '../tool-definition.js';
import { tasksActionsTool, tasksRelationsTool } from './tasks-parts.tools.js';
import {
  tasksAddParticipantTool,
  tasksAddRelationTool,
  tasksChecklistAddTool,
  tasksChecklistUpdateTool,
} from './tasks-parts-write.tools.js';

/**
 * #928: части задачи. Карточка называет задачу, сотрудника и связь, undo
 * удаляет только созданное (пункт чек-листа, участие, связь), а не задачу.
 */

const T = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ITEM = '33333333-3333-4333-8333-333333333333';
const ACTION = '44444444-4444-4444-8444-444444444444';
const U = '55555555-5555-4555-8555-555555555555';
const REL = '66666666-6666-4666-8666-666666666666';

function context(readOverride?: (path: string) => Promise<unknown>): ToolContext {
  return {
    authorization: 'Bearer t',
    screen: { moduleId: null, cardKind: null, cardId: null },
    signal: new AbortController().signal,
    available: [],
    activate: () => undefined,
    read:
      readOverride ??
      vi.fn(async (path: string) => {
        if (path === `/tasks/${T}`)
          return {
            id: T,
            number: 1042,
            title: 'Проверить смету',
            checklist: [{ id: ITEM, text: 'Собрать данные', done: false }],
          };
        if (path === `/tasks/${T2}`) return { id: T2, number: 1043, title: 'Согласовать' };
        if (path === `/directory/users/${U}`) return { id: U, displayName: 'Петров Пётр' };
        if (path === `/tasks/${T}/actions`)
          return [{ id: ACTION, name: 'Согласовать', blockedBy: [], form: null }];
        return null;
      }),
  };
}

describe('чек-лист', () => {
  it('добавление: тело, карточка, отмена удаляет пункт', async () => {
    const input = { taskId: T, text: 'Проверить смету' };
    expect(tasksChecklistAddTool.build!(input)).toEqual({
      method: 'POST',
      path: `/tasks/${T}/checklist`,
      body: { text: 'Проверить смету' },
    });
    const ctx = context();
    expect(await tasksChecklistAddTool.card!.summary(input, ctx)).toContain(
      '№1042 «Проверить смету»',
    );
    expect(await tasksChecklistAddTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([
        { label: 'Задача', value: '№1042 «Проверить смету»' },
        { label: 'Пункт', value: 'Проверить смету' },
      ]),
    );
    expect(tasksChecklistAddTool.card!.undo!(input, { id: ITEM })).toEqual({
      method: 'DELETE',
      path: `/tasks/${T}/checklist/${ITEM}`,
    });
  });

  it('отметка: карточка показывает текущий пункт и новое состояние', async () => {
    const input = { taskId: T, itemId: ITEM, done: true };
    expect(tasksChecklistUpdateTool.build!(input)).toEqual({
      method: 'PATCH',
      path: `/tasks/${T}/checklist/${ITEM}`,
      body: { done: true },
    });
    const fields = await tasksChecklistUpdateTool.card!.fields(input, context());
    expect(fields).toEqual(
      expect.arrayContaining([
        { label: 'Пункт', value: 'Собрать данные' },
        { label: 'Состояние', value: 'выполнен' },
      ]),
    );
    expect(tasksChecklistUpdateTool.card!.undo).toBeUndefined();
  });
});

describe('участники и связи', () => {
  it('участник: карточка с именем и ролью, автоматической отмены нет', async () => {
    const input = { taskId: T, userId: U, role: 'coexecutor' as const };
    expect(tasksAddParticipantTool.build!(input)).toEqual({
      method: 'POST',
      path: `/tasks/${T}/participants`,
      body: { userId: U, role: 'coexecutor' },
    });
    const fields = await tasksAddParticipantTool.card!.fields(input, context());
    expect(fields).toEqual(
      expect.arrayContaining([
        { label: 'Сотрудник', value: 'Петров Пётр' },
        { label: 'Роль', value: 'соисполнитель' },
      ]),
    );
    // Upsert роли: «Отменить» удалил бы участника, а не вернул прежнюю роль.
    expect(tasksAddParticipantTool.card!.undo).toBeUndefined();
    expect(tasksAddParticipantTool.effect).toBe('irreversible');
  });

  it('связь: карточка называет обе задачи, undo нет (связь могла существовать)', async () => {
    const input = { taskId: T, toTaskId: T2, kind: 'blocks' as const };
    expect(tasksAddRelationTool.build!(input)).toEqual({
      method: 'POST',
      path: `/tasks/${T}/relations`,
      body: { toTaskId: T2, kind: 'blocks' },
    });
    const summary = await tasksAddRelationTool.card!.summary(input, context());
    expect(summary).toContain('№1042 «Проверить смету»');
    expect(summary).toContain('№1043 «Согласовать»');
    expect(summary).toContain('блокирует');
    expect(tasksAddRelationTool.card!.undo).toBeUndefined();
    expect(tasksAddRelationTool.effect).toBe('irreversible');
  });
});

describe('чтение связей и действий', () => {
  it('связи: строки с номером, названием и id', () => {
    const data: Paginated<TaskRelation> = {
      items: [
        {
          id: REL,
          kind: 'relates',
          direction: 'out',
          task: { id: T2, number: 1043, title: 'Согласовать' },
        },
      ],
      nextCursor: null,
    };
    expect(tasksRelationsTool.project!(data, { id: T, limit: 20 })).toEqual({
      text: 'Связи задачи: 1\nсвязана: №1043 «Согласовать» (id 22222222-2222-4222-8222-222222222222)',
    });
  });

  it('действия: имя, id, блокировка и окно', () => {
    const text = tasksActionsTool.project!(
      [
        { id: ACTION, name: 'Согласовать', blockedBy: [], form: { enabled: true, sections: [] } },
        { id: T2, name: 'Приложить акт', blockedBy: [{ reason: 'Нет файла' }], form: null },
      ],
      { id: T },
    ).text;
    expect(text).toContain(
      'Согласовать (id 44444444-4444-4444-8444-444444444444) · есть окно ввода',
    );
    expect(text).toContain(
      'Приложить акт (id 22222222-2222-4222-8222-222222222222) — ЗАБЛОКИРОВАНО',
    );
  });
});
