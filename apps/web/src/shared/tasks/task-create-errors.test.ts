import { describe, expect, it } from 'vitest';
import { ErrorCode, ui } from '@nodus/contracts';

import { ApiError } from '../api-client.js';
import { createFailureOf } from './task-create-errors.js';

/** Отказы сервера в окне создания (#432, Р9): текст, подсветка, перечитка типов. */

const apiError = (code: string, details?: Record<string, unknown>) =>
  new ApiError(code, 'fail', code === ErrorCode.PROCESS_TYPE_FORBIDDEN ? 403 : 422, details);

describe('createFailureOf', () => {
  it('403 — тип недоступен: текст в окне и перечитать типы', () => {
    const failure = createFailureOf(apiError(ErrorCode.PROCESS_TYPE_FORBIDDEN));
    expect(failure).toMatchObject({ message: ui.taskCreate.forbidden, refetchTypes: true });
    expect(failure.invalidKeys.size).toBe(0);
  });

  it('422 «не хватает» — подсветка полей из details и перечитать типы', () => {
    const failure = createFailureOf(
      apiError(ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED, { fields: ['deadline', 'description'] }),
    );
    expect(failure.message).toBeNull();
    expect([...failure.invalidKeys]).toEqual(['deadline', 'description']);
    expect(failure.refetchTypes).toBe(true);
  });

  it('422 атрибута — подсветка поля `cf.<id>`', () => {
    const failure = createFailureOf(
      apiError(ErrorCode.CUSTOM_FIELD_VALUE_INVALID, { issues: [{ fieldId: 'abc' }] }),
    );
    expect([...failure.invalidKeys]).toEqual(['cf.abc']);
    expect(failure.refetchTypes).toBe(false);
  });

  it('отказ перехода при создании в колонке — причина кнопки (#402)', () => {
    const failure = createFailureOf(
      apiError(ErrorCode.WORKFLOW_TRANSITION_BLOCKED, {
        reasons: [{ kind: 'no_open_subtasks', count: 1 }],
      }),
    );
    expect(failure.message).toContain('подзадач');
  });

  it('устаревшее скрытое значение и прочие сбои — текстом', () => {
    expect(createFailureOf(apiError(ErrorCode.PROCESS_TYPE_PRESET_INVALID)).message).toBe(
      ui.taskCreate.presetInvalid,
    );
    expect(createFailureOf(new Error('network')).message).toBe(ui.taskCreate.submitFailed);
  });
});
