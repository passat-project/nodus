import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import type { UserCard, UserListItem } from '@nodus/contracts';

import { employeeProfileDefs } from './employee-profile-fields.js';

/** Карточка профиля #750: у каждого поля — своя иконка (иначе строки-
 *  соседи читаются как один смысловой блок: подразделение/город/кабинет/
 *  удалёнка были все `Building2`). */
describe('employeeProfileDefs — иконки полей', () => {
  it('у каждого поля профиля уникальная иконка', () => {
    const defs = employeeProfileDefs({
      card: {
        id: 'u1',
        email: 'u1@nodus.by',
        displayName: 'Иван Петров',
        avatarUrl: null,
      } as unknown as UserCard,
      listItem: {
        id: 'u1',
        displayName: 'Иван Петров',
        managerId: null,
        positionName: null,
      } as unknown as UserListItem,
      manager: undefined,
      openCard: () => {},
    });
    const iconTypes = defs.map((def) => (def.icon as ReactElement).type);
    expect(new Set(iconTypes).size).toBe(iconTypes.length);
  });
});
