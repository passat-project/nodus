import { beforeEach, describe, expect, it } from 'vitest';

import { pressOf, resetPressDemo, returnPress, submitPress, withdrawPress } from './press.js';
import { userIds } from './users.js';

const TASK_ONE = '30000000-0000-4000-8000-000000000017';
const TASK_TWO = '30000000-0000-4000-8000-000000000018';
const TASK_THREE = '30000000-0000-4000-8000-000000000019';

beforeEach(() => resetPressDemo());

describe('мок-сбор отметок (#434)', () => {
  it('обычная задача: 4 из 5, текущий пользователь ждёт и может нажать', () => {
    const press = pressOf(TASK_ONE, userIds.klimovich);
    expect(press).toMatchObject({
      total: 5,
      pressed: 4,
      completed: false,
      canSubmit: true,
      canWithdraw: false,
      transitionName: 'Завершить',
    });
    expect(press?.myEntry?.state).toBe('waiting');
  });

  it('последнее нажатие добивает кворум', () => {
    submitPress(TASK_ONE, userIds.klimovich, {
      result: { text: 'Готово', messageIds: [] },
      time: { minutes: 30, date: '2026-11-09' },
    });
    const press = pressOf(TASK_ONE, userIds.klimovich);
    expect(press).toMatchObject({
      pressed: 5,
      completed: true,
      canSubmit: false,
      canWithdraw: false,
    });
    expect(press?.myEntry?.result?.text).toBe('Готово');
  });

  it('отзыв возвращает отметку в ожидание, пока кворум не собран', () => {
    submitPress(TASK_TWO, userIds.klimovich, {
      result: { text: 'Ознакомлен', messageIds: [] },
    });
    expect(pressOf(TASK_TWO, userIds.klimovich)?.pressed).toBe(6);
    withdrawPress(TASK_TWO, userIds.klimovich);
    expect(pressOf(TASK_TWO, userIds.klimovich)).toMatchObject({
      pressed: 5,
      canSubmit: true,
    });
  });

  it('все, кроме климовича, сдали: последнее нажатие закрывает заявку', () => {
    const total = Object.values(userIds).filter((id) => id !== userIds.matorin).length;
    expect(pressOf(TASK_THREE, userIds.klimovich)).toMatchObject({
      pressed: total - 1,
      total,
      canSubmit: true,
    });
    submitPress(TASK_THREE, userIds.klimovich, {
      result: { text: 'Ознакомлен', messageIds: [] },
    });
    expect(pressOf(TASK_THREE, userIds.klimovich)).toMatchObject({
      pressed: total,
      completed: true,
    });
  });

  it('возврат выборочно снимает кворум и сохраняет причину', () => {
    const after = returnPress(TASK_TWO, [userIds.polomar], 'Уточнить', userIds.klimovich);
    expect(after).toMatchObject({ pressed: 4, completed: false });
    expect(after?.entries.find((entry) => entry.userId === userIds.polomar)).toMatchObject({
      state: 'returned',
      returnReason: 'Уточнить',
    });
  });
});
