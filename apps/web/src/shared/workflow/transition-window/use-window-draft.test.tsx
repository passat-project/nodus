// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CustomFieldValue } from '@nodus/contracts';

import { draftMessageIds, emptyDraft, useWindowDraft } from './use-window-draft.js';
import type { TransitionWindowContext } from './window-context.js';

/** Черновик окна перехода (#632, Р12): префилл формульных слотов — cf.<uuid>
 *  и системные поля с проверкой типа, выбранные файлы заменяют перенос,
 *  пустой префилл не трогает значения, сброс возвращает открытие. */

const CF = '35560000-0000-4000-8000-000000000061';
const MSG = '21000000-0000-4000-8000-000000000061';

function context(): TransitionWindowContext {
  return {
    fields: {
      description: 'было',
      deadline: null,
      assigneeId: null,
      plannedMinutes: null,
      customFields: {},
    },
    lastResult: { text: 'итог', messageIds: [MSG] },
  } as never;
}

describe('emptyDraft: префилл формульных слотов (#632, Р12)', () => {
  it('cf-ключ — в атрибуты; системные поля — по типу; мусор и пустота игнорируются', () => {
    const prefill: Record<string, CustomFieldValue> = {
      [`cf.${CF}`]: 'КЖ-1',
      description: 'новое',
      deadline: '2026-12-01',
      assignee: 'user-1',
      plannedMinutes: 30,
      unknown: 'x',
      [`cf.not-a-uuid`]: 'мимо',
      empty: null,
    };
    const draft = emptyDraft(context(), prefill);
    expect(draft.fields.customFields[CF]).toBe('КЖ-1');
    expect(draft.fields.description).toBe('новое');
    expect(draft.fields.deadline).toBe('2026-12-01');
    expect(draft.fields.assigneeId).toBe('user-1');
    expect(draft.fields.plannedMinutes).toBe(30);
    expect(Object.keys(draft.fields.customFields)).toHaveLength(1);
  });

  it('нетипичные значения системных полей не попадают в черновик', () => {
    const draft = emptyDraft(context(), {
      description: 5,
      deadline: true,
      assignee: 7,
      plannedMinutes: '30',
    } as never);
    expect(draft.fields.description).toBe('было');
    expect(draft.fields.deadline).toBeNull();
    expect(draft.fields.assigneeId).toBeNull();
    expect(draft.fields.plannedMinutes).toBeNull();
  });

  it('без префилла — текущие значения и перенос прошлой ревизии', () => {
    const draft = emptyDraft(context());
    expect(draft.resultText).toBe('итог');
    expect(draft.carried).toEqual([MSG]);
    expect(draft.fields.customFields).toEqual({});
  });
});

describe('draftMessageIds', () => {
  it('перенос + файлы + сообщения без дублей', () => {
    expect(
      draftMessageIds({ carried: [MSG], files: [MSG, 'm2'], messages: ['m2', 'm3'] } as never),
    ).toEqual([MSG, 'm2', 'm3']);
  });
});

describe('useWindowDraft', () => {
  it('без контекста — пустой черновик; сеттеры правят своё поле', () => {
    const { result } = renderHook(() => useWindowDraft(null));
    expect(result.current.draft.fields.description).toBe('');
    act(() => {
      result.current.setResultText('текст');
      result.current.setComment('комментарий');
      result.current.setFields({
        description: 'задача',
        deadline: null,
        assigneeId: null,
        plannedMinutes: 15,
        customFields: {},
      });
    });
    expect(result.current.draft.resultText).toBe('текст');
    expect(result.current.draft.comment).toBe('комментарий');
    expect(result.current.draft.fields.description).toBe('задача');
  });

  it('выбор файла заменяет перенос; повтор — снятие; сброс возвращает открытие', () => {
    const { result } = renderHook(() => useWindowDraft(context(), { [`cf.${CF}`]: 'КЖ-9' }));
    expect(result.current.draft.carried).toEqual([MSG]);
    act(() => result.current.toggleFile(MSG));
    expect(result.current.draft.carried).toEqual([]);
    expect(result.current.draft.files).toEqual([MSG]);
    act(() => result.current.toggleFile(MSG));
    expect(result.current.draft.files).toEqual([]);
    act(() => {
      result.current.toggleMessage('m2');
      result.current.addFiles(['m3', 'm3']);
    });
    expect(result.current.draft.messages).toEqual(['m2']);
    expect(result.current.draft.files).toEqual(['m3']);
    act(() => {
      void result.current.reset();
    });
    expect(result.current.draft.fields.customFields[CF]).toBe('КЖ-9');
    expect(result.current.draft.carried).toEqual([MSG]);
  });
});
