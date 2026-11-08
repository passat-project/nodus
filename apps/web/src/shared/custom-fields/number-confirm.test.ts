import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { ApiError } from '../api-client.js';
import {
  isNumberConfirmCancelled,
  numberingErrorText,
  useNumberConfirmStore,
  withEmptyNumberConfirm,
} from './number-confirm.js';

const FIELD = '00000000-0000-4000-8000-000000000033';

const emptyError = () =>
  new ApiError(ErrorCode.NUMBER_SEGMENT_EMPTY, 'empty', 409, {
    fieldId: FIELD,
    fieldName: '№ накладной выдачи',
    segments: [{ fieldNumber: 37, source: 'project', name: 'Инв. №' }],
    example: '-1',
  });

/** Окно пустого поля номера (#630): один повтор с подтверждением или отмена. */
describe('withEmptyNumberConfirm', () => {
  it('«Выдать так» — повтор того же действия с подтверждением', async () => {
    const run = vi
      .fn<(confirmed: boolean) => Promise<string>>()
      .mockRejectedValueOnce(emptyError())
      .mockResolvedValueOnce('0412-1');
    const pending = withEmptyNumberConfirm(run);
    await vi.waitFor(() => expect(useNumberConfirmStore.getState().request).not.toBeNull());
    expect(useNumberConfirmStore.getState().request?.details.example).toBe('-1');
    useNumberConfirmStore.getState().answer(true);
    await expect(pending).resolves.toBe('0412-1');
    expect(run.mock.calls.map(([confirmed]) => confirmed)).toEqual([false, true]);
    expect(useNumberConfirmStore.getState().request).toBeNull();
  });

  it('«Вернуться и заполнить» — отмена без повтора', async () => {
    const run = vi.fn<(confirmed: boolean) => Promise<string>>().mockRejectedValue(emptyError());
    const pending = withEmptyNumberConfirm(run);
    await vi.waitFor(() => expect(useNumberConfirmStore.getState().request).not.toBeNull());
    useNumberConfirmStore.getState().answer(false);
    const error = await pending.catch((reason: unknown) => reason);
    expect(isNumberConfirmCancelled(error)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('другие ошибки не спрашивают человека', async () => {
    const failure = new ApiError(ErrorCode.NUMBER_CONTAINER_MISSING, 'missing', 409, {});
    await expect(withEmptyNumberConfirm(() => Promise.reject(failure))).rejects.toBe(failure);
    expect(useNumberConfirmStore.getState().request).toBeNull();
  });
});

describe('numberingErrorText', () => {
  it('отказ выдачи — с номером и причиной', () => {
    const error = new ApiError(ErrorCode.NUMBER_CONTAINER_MISSING, 'missing', 409, {
      fieldId: FIELD,
      fieldName: 'Изм.',
      reason: 'no_folder',
      index: 0,
      name: 'Комплект',
    });
    expect(numberingErrorText(error)).toBe(
      'Номер «Изм.» не выдан: запись не лежит в папке вида «Комплект»',
    );
  });

  it('прочие NUMBER_* — словарь, чужие коды — null', () => {
    expect(numberingErrorText(new ApiError(ErrorCode.NUMBER_CELL_IMMUTABLE, 'x', 422))).toMatch(
      /выдаёт процесс/,
    );
    expect(numberingErrorText(new ApiError(ErrorCode.VALIDATION_FAILED, 'x', 400))).toBeNull();
    expect(numberingErrorText(new Error('boom'))).toBeNull();
  });
});
