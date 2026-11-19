import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerCardBridge } from '../lib/card-bridge.js';
import {
  openEmployeeCardFromChat,
  stageEmployeeCardTab,
  subscribeEmployeeCardTab,
  takeEmployeeCardTab,
} from './employee-card-nav.js';

/** Профиль сотрудника из мессенджера (#972): одноразовая пристойка стартовой
 *  вкладки «Задачи» + подписка живой карточки (openCard той же карточки —
 *  no-op) + единый helper открытия с rect источника. */

const USER = '00000000-0000-4000-8000-0000000000e1';
const OTHER = '00000000-0000-4000-8000-0000000000e2';

afterEach(() => {
  takeEmployeeCardTab(USER);
  takeEmployeeCardTab(OTHER);
});

describe('employee-card-nav', () => {
  it('пристойка одноразовая и только для своего сотрудника', () => {
    expect(takeEmployeeCardTab(OTHER)).toBe(null);
    stageEmployeeCardTab(USER, 'tasks');
    expect(takeEmployeeCardTab(OTHER)).toBe(null);
    expect(takeEmployeeCardTab(USER)).toBe('tasks');
    expect(takeEmployeeCardTab(USER)).toBe(null);
  });

  it('подписка срабатывает на пристойку, потребление — в колбэке', () => {
    const seen: (string | null)[] = [];
    const unsub = subscribeEmployeeCardTab(() => seen.push(takeEmployeeCardTab(USER)));
    stageEmployeeCardTab(OTHER, 'tasks'); // чужой — колбэк молчит (null)
    expect(seen).toEqual([null]);
    expect(takeEmployeeCardTab(OTHER)).toBe('tasks'); // чужая пристойка не съедена
    stageEmployeeCardTab(USER, 'tasks');
    expect(seen).toEqual([null, 'tasks']); // съедена сразу — no-op openCard не мешает
    unsub();
    stageEmployeeCardTab(USER, 'tasks');
    expect(takeEmployeeCardTab(USER)).toBe('tasks'); // после отписки ждёт потребителя
  });

  it('клик из чата: карточка сотрудника через мост + пристойка «Задачи»', () => {
    const opener = vi.fn();
    const close = registerCardBridge(opener);
    const rect = { x: 10, y: 20, width: 36, height: 36 };
    openEmployeeCardFromChat(USER, rect);
    expect(opener).toHaveBeenCalledWith({ kind: 'employee', id: USER }, rect);
    expect(takeEmployeeCardTab(USER)).toBe('tasks');
    close();
  });
});
