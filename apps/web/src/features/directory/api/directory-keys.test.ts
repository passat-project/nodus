import { describe, expect, it } from 'vitest';

import { directoryKeys } from './directory-keys.js';

/** Ключи кэша домена «Сотрудники» (#923): карточка и presence — свои ветки. */
describe('directoryKeys (#923)', () => {
  it('карточка сотрудника — в ветке directory, presence — общий ключ', () => {
    expect(directoryKeys.all).toEqual(['directory']);
    expect(directoryKeys.userCard('u1')).toEqual(['directory', 'user', 'u1']);
    expect(directoryKeys.users()).toEqual(['directory', 'users']);
    expect(directoryKeys.presence()).toEqual(['directory', 'presence']);
    expect(directoryKeys.departments('legal')).toEqual(['directory', 'departments', 'legal']);
  });
});
