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

  it('почта ужимается многоточием, полное значение — в подсказке (#999)', () => {
    const email = 'very.long.employee.mailbox@construction-holding.by';
    const def = employeeProfileDefs({
      card: {
        id: 'u1',
        email,
        displayName: 'Иван',
        avatarUrl: null,
        roles: [],
      } as unknown as UserCard,
      listItem: { managerId: null, positionName: null } as UserListItem,
      manager: undefined,
      openCard: () => {},
    }).find((entry) => entry.key === 'email');
    const node = def?.render() as ReactElement<{
      className?: string;
      title?: string;
      children?: unknown;
    }>;
    expect(node.props.className).toContain('min-w-0');
    expect(node.props.className).toContain('truncate');
    expect(node.props.title).toBe(email);
    expect(node.props.children).toBe(email);
  });

  it('дата приёма — с годом, день рождения — без года (#999)', () => {
    const defs = employeeProfileDefs({
      card: {
        id: 'u1',
        email: 'u1@nodus.by',
        displayName: 'Иван',
        avatarUrl: null,
        roles: [] as UserCard['roles'],
        hiredAt: new Date(2021, 8, 3, 12).toISOString(),
        birthDate: new Date(1990, 4, 17, 12).toISOString(),
      } as UserCard,
      listItem: { managerId: null, positionName: null } as UserListItem,
      manager: undefined,
      openCard: () => {},
    });
    const hired = defs.find((def) => def.key === 'hiredAt')?.render() as ReactElement<{
      children?: unknown;
    }>;
    const birth = defs.find((def) => def.key === 'birthDate')?.render() as ReactElement<{
      children?: unknown;
    }>;
    expect(hired.props.children).toBe('3 сентября 2021');
    expect(birth.props.children).toBe('17 мая');
  });
});
