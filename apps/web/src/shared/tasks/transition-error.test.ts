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
    },
    { kind: 'formula', title: 'Комплект не собран' },
  ];

  it('gateReasonLines: подпись + записи-ссылки + счётчик невидимых', () => {
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
    });
    expect(formula).toEqual({ title: 'Комплект не собран', refs: [], hiddenCount: 0 });
  });

  it('gateReasonsText: имена записей и «и ещё N» — для тостов и тултипов', () => {
    const text = gateReasonsText(reasons);
    expect(text).toContain('Задания смежникам не выполнены: Задание → КЖ1.1');
    // 3 записи — форма «few» русской плюрализации.
    expect(text).toContain(`${ui.tasks.gateHiddenPrefix} 3 ${ui.tasks.gateHiddenFew}`);
    expect(text).toContain('Комплект не собран');
  });

  it('без подписи — запасной текст вида проверки', () => {
    expect(gateReasonsText([{ kind: 'records' }])).toBe(ui.tasks.gate.records);
  });
});
