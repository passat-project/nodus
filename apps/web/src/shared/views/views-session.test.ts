// @vitest-environment jsdom
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from '../auth-store.js';
import { resetSessionState } from '../session-reset.js';
import { useViewStore, viewsStorageKey } from './view-store.js';
import { startViewsSession } from './views-session.js';

/**
 * #876 (AUD-005): настройка колонок списков принадлежит пользователю, а не
 * браузеру. На общем компьютере следующий вошедший не видит чужой набор
 * колонок; legacy-ключ без пользователя больше не применяется.
 */
const USER_A = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'a@nodus.by',
  displayName: 'Пользователь A',
  permissions: [] as string[],
};
const USER_B = {
  id: '44444444-4444-4444-8444-444444444444',
  email: 'b@nodus.by',
  displayName: 'Пользователь B',
  permissions: [] as string[],
};

const stored = (key: string): unknown => {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
};

beforeEach(() => {
  localStorage.clear();
  useViewStore.setState({ views: {}, sorts: {} });
  useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null });
  // Подписку на смену пользователя в приложении включает оболочка.
  startViewsSession();
});

describe('Настройка колонок на пользователя (#876)', () => {
  it('ключ содержит id пользователя: настройка A лежит в его ключе', () => {
    act(() => {
      useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: USER_A });
    });
    act(() => useViewStore.getState().setFieldVisible('tasks.list', 'creator', false));

    expect(viewsStorageKey(USER_A.id)).toContain(USER_A.id);
    expect(stored(viewsStorageKey(USER_A.id))).toMatchObject({
      state: { views: { 'tasks.list': { creator: { visible: false } } } },
    });
  });

  it('после смены пользователя чужой вид не применяется, повторный вход возвращает свой', () => {
    act(() => {
      useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: USER_A });
    });
    act(() => useViewStore.getState().setFieldVisible('tasks.list', 'creator', false));

    // B входит в той же вкладке: колонки A не применяются.
    act(() => {
      useAuthStore.setState({ status: 'authenticated', accessToken: 't2', user: USER_B });
    });
    expect(useViewStore.getState().views['tasks.list']).toBeUndefined();

    // A вернулся — его настройка на месте.
    act(() => {
      useAuthStore.setState({ status: 'authenticated', accessToken: 't3', user: USER_A });
    });
    expect(useViewStore.getState().views['tasks.list']?.creator?.visible).toBe(false);
  });

  it('legacy-ключ без пользователя не применяется и чистится сбросом сессии', () => {
    localStorage.setItem(
      'nodus-views-v2',
      JSON.stringify({
        state: { views: { 'tasks.list': { title: { visible: false } } }, sorts: {} },
        version: 1,
      }),
    );

    act(() => {
      useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: USER_A });
    });
    // Общий ключ больше не читается: набор колонок — дефолтный.
    expect(useViewStore.getState().views).toEqual({});

    act(() => resetSessionState(USER_A.id));
    expect(localStorage.getItem('nodus-views-v2')).toBeNull();
    expect(useViewStore.getState().views).toEqual({});
    // Кэш пользователя сбросом не удаляется — повторный вход быстрый.
    expect(localStorage.getItem(viewsStorageKey(USER_A.id))).not.toBeNull();
  });
});
