import { describe, expect, it } from 'vitest';

import type { ToolContext } from '../tool-definition.js';
import { tasksTransitionTool, tasksTransitionsTool } from './tasks-transition.tools.js';

/**
 * Переходы задач (#920): «заверши задачу» — через доступный переход, а не
 * угаданный stageId. Тесты держат проекции каталога, тело и карточку.
 */

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const TRANSITION_ID = '22222222-2222-4222-8222-222222222222';

const transition = {
  id: TRANSITION_ID,
  name: 'Завершить',
  toStageId: '33333333-3333-4333-8333-333333333333',
  toStageName: 'Готово',
  toStageOutcome: 'completed',
  blockedBy: [],
  form: { enabled: true, sections: [{ title: 'Комментарий', kind: 'comment' }] },
};

const ctx = {
  authorization: 'Bearer token',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  read: async (path: string) =>
    path.endsWith('/transitions')
      ? [{ ...transition, blockedBy: [{ kind: 'checklist_complete', count: 2 }] }]
      : { id: TASK_ID, number: 165, title: 'Смонтировать узел' },
} as ToolContext;

describe('tasks.transitions: доступные переходы (#920)', () => {
  it('отдаёт id, название, целевую стадию, окно и ограничения', () => {
    const { text, entity } = tasksTransitionsTool.project!(
      [
        transition,
        {
          ...transition,
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Вернуть',
          toStageName: 'В работе',
          toStageOutcome: null,
          blockedBy: [{ kind: 'fields_required', fields: ['deadline'] }],
          form: null,
        },
      ],
      { id: TASK_ID },
    );
    expect(text).toContain('«Завершить» → стадия «Готово»');
    expect(text).toContain(`id ${TRANSITION_ID}`);
    expect(text).toContain('окно ввода: Комментарий');
    expect(text).toContain('завершает задачу');
    expect(text).toContain('«Вернуть» → стадия «В работе»');
    expect(text).toContain('ЕСТЬ ОГРАНИЧЕНИЯ');
    expect(entity).toEqual({ href: `?cards=task:${TASK_ID}`, label: 'Задача' });
  });

  it('пустой список — честная причина, а не выдуманный переход', () => {
    const { text } = tasksTransitionsTool.project!([], { id: TASK_ID });
    expect(text).toContain('Доступных переходов нет');
  });

  it('build: маршрут переходов задачи', () => {
    expect(tasksTransitionsTool.build!({ id: TASK_ID })).toEqual({
      path: `/tasks/${TASK_ID}/transitions`,
    });
  });
});

describe('tasks.transition: выполнение перехода (#920)', () => {
  it('build: комментарий идёт в форму перехода, без комментария — пустое тело', () => {
    expect(
      tasksTransitionTool.build!({
        id: TASK_ID,
        transitionId: TRANSITION_ID,
        comment: 'Готово, проверил',
      }),
    ).toEqual({
      method: 'POST',
      path: `/tasks/${TASK_ID}/transitions/${TRANSITION_ID}`,
      body: { form: { comment: 'Готово, проверил' } },
    });
    expect(tasksTransitionTool.build!({ id: TASK_ID, transitionId: TRANSITION_ID })).toMatchObject({
      body: {},
    });
  });

  it('project: называет задачу и новую стадию из ответа портала', () => {
    const { text, entity } = tasksTransitionTool.project!(
      {
        task: { id: TASK_ID, number: 165, title: 'Смонтировать узел', stage: { name: 'Готово' } },
        transitions: [],
      },
      { id: TASK_ID, transitionId: TRANSITION_ID },
    );
    expect(text).toContain('Переход выполнен: задача №165 «Смонтировать узел»');
    expect(text).toContain('стадии «Готово»');
    expect(entity?.href).toBe(`?cards=task:${TASK_ID}`);
  });

  it('карточка: реальные номер, название, переход и ограничения', async () => {
    const summary = await tasksTransitionTool.card!.summary(
      { id: TASK_ID, transitionId: TRANSITION_ID },
      ctx,
    );
    expect(summary).toContain('Переход «Завершить»');
    expect(summary).toContain('№165 «Смонтировать узел»');
    const fields = await tasksTransitionTool.card!.fields(
      { id: TASK_ID, transitionId: TRANSITION_ID, comment: 'Готово' },
      ctx,
    );
    expect(fields).toEqual(
      expect.arrayContaining([
        { label: 'Переход', value: 'Завершить' },
        { label: 'Новая стадия', value: 'Готово' },
        { label: 'Ограничения', value: 'есть ограничения: checklist_complete' },
        { label: 'Комментарий', value: 'Готово' },
      ]),
    );
    expect(tasksTransitionTool.card!.undo).toBeUndefined();
  });
});
