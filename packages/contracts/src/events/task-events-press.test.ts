import { describe, expect, it } from 'vitest';

import {
  taskPressRequestedPayloadSchema,
  taskPressReturnedPayloadSchema,
  taskPressSubmittedPayloadSchema,
} from './task-events.js';

const base = {
  taskId: crypto.randomUUID(),
  number: 7,
  audience: [crypto.randomUUID()],
};

describe('события сбора отметок (#434)', () => {
  it('старт, сдача и возврат проходят схему', () => {
    expect(
      taskPressRequestedPayloadSchema.parse({
        ...base,
        title: 'Сдать отчёт',
        transitionName: 'Завершить',
        broadcast: false,
        participantIds: [crypto.randomUUID()],
      }).participantIds,
    ).toHaveLength(1);
    expect(
      taskPressSubmittedPayloadSchema.parse({
        ...base,
        title: 'Сдать отчёт',
        transitionName: 'Завершить',
        broadcast: false,
        result: { text: 'Готово', fileCount: 2, minutes: 30 },
        pressed: 1,
        total: 2,
      }).pressed,
    ).toBe(1);
    expect(
      taskPressReturnedPayloadSchema.parse({
        ...base,
        title: 'Сдать отчёт',
        transitionName: 'Завершить',
        broadcast: true,
        userIds: [crypto.randomUUID()],
        reason: 'Доработать',
      }).reason,
    ).toBe('Доработать');
  });

  it('пустой возврат и пустой старт отвергаются', () => {
    expect(() =>
      taskPressReturnedPayloadSchema.parse({
        ...base,
        title: 'Т',
        transitionName: 'Завершить',
        broadcast: false,
        userIds: [],
        reason: 'x',
      }),
    ).toThrow();
    expect(() =>
      taskPressRequestedPayloadSchema.parse({
        ...base,
        title: 'Т',
        transitionName: 'Завершить',
        broadcast: false,
        participantIds: [],
      }),
    ).toThrow();
  });
});
