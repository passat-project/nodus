import { describe, expect, it } from 'vitest';

import { pressConfigDraftSchema, pressConfigSchema, pressEntryResultOf } from './press.js';
import { workflowDraftTransitionSchema } from './workflow-document.schemas.js';

const source = { kind: 'coexecutors' as const };

describe('сбор отметок (#434)', () => {
  it('черновик допускает пустые источники — их ловит публикация', () => {
    const press = pressConfigDraftSchema.parse({ quorum: { kind: 'all' } });
    expect(press.sources).toEqual([]);
    expect(press.order).toBe('parallel');
    expect(press.excludeAuthor).toBe(true);
  });

  it('граница публикации требует источник', () => {
    expect(() => pressConfigSchema.parse({ sources: [], quorum: { kind: 'all' } })).toThrow();
    expect(
      pressConfigSchema.parse({
        sources: [source],
        quorum: { kind: 'count', count: 3 },
      }).quorum,
    ).toEqual({ kind: 'count', count: 3 });
  });

  it('кнопка маршрута принимает настройку сбора', () => {
    const transition = workflowDraftTransitionSchema.parse({
      id: 'new:complete',
      code: null,
      name: 'Завершить',
      fromStageId: 'new:active',
      toStageId: 'new:done',
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: { conditions: [], validators: [], postFunctions: [] },
      press: { sources: [source], quorum: { kind: 'all' } },
    });
    expect(transition.press?.sources).toEqual([source]);
  });

  it('проекция отметки: дубли сообщений, текст или комментарий, время', () => {
    expect(
      pressEntryResultOf({
        result: { text: ' Итог ', messageIds: ['m1', 'm1', 'm2'] },
        time: { minutes: 30, date: '2026-11-10' },
      }),
    ).toEqual({
      text: 'Итог',
      messageIds: ['m1', 'm2'],
      fileCount: 2,
      minutes: 30,
      date: '2026-11-10',
    });
    expect(pressEntryResultOf({ comment: 'Комментарий' })).toMatchObject({
      text: 'Комментарий',
      fileCount: 0,
      minutes: null,
    });
  });
});
