// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { useAuthStore } from './auth-store.js';

/** Точечное обновление карточки вошедшего (#923): смена своего имени в
 *  профиле сразу видна в топбаре, без перезагрузки и повторного /auth/me. */
describe('auth-store.updateProfile (#923)', () => {
  it('меняет displayName вошедшего', () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: 'u1', email: 'u1@nodus.by', displayName: 'Иванов Иван', permissions: [] },
    });
    useAuthStore.getState().updateProfile({ displayName: 'Иванов Пётр' });
    expect(useAuthStore.getState().user?.displayName).toBe('Иванов Пётр');
  });

  it('анонимному не создаёт пользователя', () => {
    useAuthStore.setState({ status: 'anonymous', user: null });
    useAuthStore.getState().updateProfile({ displayName: 'Кто-то' });
    expect(useAuthStore.getState().user).toBeNull();
  });
});
