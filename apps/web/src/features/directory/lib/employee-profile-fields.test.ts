import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ui, type UserCard, type UserListItem } from '@nodus/contracts';

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
        roles: [] as UserCard['roles'],
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

  it('пустая должность — «не задано», заполненная — значение (синим, #923)', () => {
    const base = {
      card: {
        id: 'u1',
        email: 'u1@nodus.by',
        displayName: 'Иван',
        avatarUrl: null,
        roles: [] as UserCard['roles'],
      } as UserCard,
      manager: undefined,
      openCard: () => {},
    };
    const empty = employeeProfileDefs({
      ...base,
      listItem: { managerId: null, positionName: null } as UserListItem,
    }).find((def) => def.key === 'position');
    expect(empty?.render()).toBe(ui.common.notSet);

    const filled = employeeProfileDefs({
      ...base,
      listItem: { managerId: null, positionName: 'Инженер' } as UserListItem,
    }).find((def) => def.key === 'position');
    const node = filled?.render() as ReactElement<{ className?: string }>;
    expect(node.props.className).toContain('text-info');
  });

  it('отчество — первое поле карточки (порядок приёмки 18.11.2026, #923)', () => {
    const defs = employeeProfileDefs({
      card: {
        id: 'u1',
        email: 'u1@nodus.by',
        displayName: 'Иван',
        avatarUrl: null,
        roles: [] as UserCard['roles'],
      } as UserCard,
      listItem: { managerId: null, positionName: null } as UserListItem,
      manager: undefined,
      openCard: () => {},
    });
    expect(defs[0]?.key).toBe('middleName');
  });

  it('руководитель — переход в его карточку стеком (#923)', () => {
    const openCard = vi.fn();
    const manager = {
      id: 'boss-1',
      displayName: 'Пётр Начальников',
      avatarUrl: null,
    } as UserListItem;
    const def = employeeProfileDefs({
      card: {
        id: 'u1',
        email: 'u1@nodus.by',
        displayName: 'Иван',
        avatarUrl: null,
        roles: [] as UserCard['roles'],
      } as UserCard,
      listItem: { managerId: 'boss-1', positionName: null } as UserListItem,
      manager,
      openCard,
    }).find((entry) => entry.key === 'manager');
    expect(def?.render()).toBeTruthy();
  });
});
