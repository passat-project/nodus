import { describe, expect, it } from 'vitest';
import { ui } from '@nodus/contracts';
import type { TransitionBlockReason } from '@nodus/contracts';

import { ApiError } from '../api-client.js';
import { gateReasonLines, gateReasonsText, transitionErrorText } from './transition-error.js';

describe('transitionErrorText (#402)', () => {
  it('гейт — причины кнопки, а не общий текст', () => {
    const error = new ApiError('WORKFLOW_TRANSITION_BLOCKED', 'blocked', 409, {
      reasons: [{ kind: 'no_open_subtasks', count: 2 }],
    });
    expect(transitionErrorText(error)).toContain('подзадач');
  });

  it('нет перехода — имя текущего статуса в тексте', () => {
    const error = new ApiError('WORKFLOW_TRANSITION_NOT_ALLOWED', 'not allowed', 409, {
      fromStageName: 'В работе',
    });
    expect(transitionErrorText(error)).toContain('«В работе»');
  });
});

describe('причины records/formula (#635): структура и строка', () => {
  const reasons: TransitionBlockReason[] = [
    {
      kind: 'records',
      title: 'Задания смежникам не выполнены',
      records: [
        {
          id: '30000000-0000-4000-8000-000000000201',
          entityKind: 'task',
          name: 'Задание → КЖ1.1',
        },
      ],
      hiddenCount: 3,
      totalCount: 9,
    },
    { kind: 'formula', title: 'Комплект не собран' },
  ];

  it('gateReasonLines: подпись + записи-ссылки + счётчики', () => {
    const [records, formula] = gateReasonLines(reasons);
    expect(records).toEqual({
      title: 'Задания смежникам не выполнены',
      refs: [
        {
          id: '30000000-0000-4000-8000-000000000201',
          entityKind: 'task',
          name: 'Задание → КЖ1.1',
        },
      ],
      hiddenCount: 3,
      totalCount: 9,
      overflow: false,
    });
    expect(formula).toEqual({
      title: 'Комплект не собран',
      refs: [],
      hiddenCount: 0,
      totalCount: 0,
      overflow: false,
    });
  });

  it('gateReasonsText: имена записей, «и ещё N» невидимых и хвост totalCount', () => {
    const text = gateReasonsText(reasons);
    expect(text).toContain('Задания смежникам не выполнены: Задание → КЖ1.1');
    // 3 записи — форма «few» русской плюрализации.
    expect(text).toContain(`${ui.tasks.gateHiddenPrefix} 3 ${ui.tasks.gateHiddenFew}`);
    // 9 нарушителей, показан 1: хвост «и ещё 8 записей» (totalCount).
    expect(text).toContain(`${ui.tasks.gateHiddenPrefix} 8 ${ui.tasks.gateMoreMany}`);
    expect(text).toContain('Комплект не собран');
  });

  it('переполненная выборка: «проверка не может быть посчитана», записей нет', () => {
    const overflow: TransitionBlockReason[] = [
      { kind: 'records', title: 'Все подзадачи выполнены', records: [], overflow: true },
    ];
    expect(gateReasonLines(overflow)[0]!.overflow).toBe(true);
    expect(gateReasonsText(overflow)).toBe(
      `Все подзадачи выполнены: ${ui.tasks.gateOverflowPrefix} 500 ${ui.tasks.gateMoreMany}`,
    );
  });

  it('без подписи — запасной текст вида проверки', () => {
    expect(gateReasonsText([{ kind: 'records' }])).toBe(ui.tasks.gate.records);
  });
});
