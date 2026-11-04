// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Permission } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { useCanManageDictionaries } from './use-can-manage-dictionaries.js';

function signIn(permissions: Permission[]) {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: null,
    user: {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'admin@nodus.by',
      displayName: 'Администратор Системный',
      permissions,
    },
  });
}

/** #491: хук — единственная точка проверки права на справочники в окне
 *  атрибута; без `dictionary.manage` списки и варианты закрываются. */
describe('useCanManageDictionaries (#491)', () => {
  afterEach(() => {
    useAuthStore.setState({ status: 'unknown', accessToken: null, user: null });
  });

  it('true с правом dictionary.manage', () => {
    signIn([Permission.CUSTOM_FIELD_MANAGE, Permission.DICTIONARY_MANAGE]);
    const { result } = renderHook(() => useCanManageDictionaries());
    expect(result.current).toBe(true);
  });

  it('false без права dictionary.manage', () => {
    signIn([Permission.CUSTOM_FIELD_MANAGE]);
    const { result } = renderHook(() => useCanManageDictionaries());
    expect(result.current).toBe(false);
  });
});
