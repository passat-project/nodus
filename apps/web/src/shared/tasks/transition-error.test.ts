import { describe, expect, it } from 'vitest';

import { ApiError } from '../api-client.js';
import { transitionErrorText } from './transition-error.js';

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
