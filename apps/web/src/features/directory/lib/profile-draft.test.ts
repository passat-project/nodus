import { describe, expect, it } from 'vitest';
import type { UserCard } from '@nodus/contracts';

import { buildProfilePatches, draftOf } from './profile-draft.js';

/** Окно профиля (#923): сохраняются ТОЛЬКО изменённые поля, self-поля идут в
 *  `/me`, структура/HR — карточкой; руководитель в патчи не попадает вообще. */

const card = (overrides: Partial<UserCard> = {}): UserCard => ({
  id: 'user-1',
  email: 'user@nodus.by',
  displayName: 'Иванов Иван',
  status: 'active',
  lastName: 'Иванов',
  firstName: 'Иван',
  middleName: null,
  managerId: 'boss-1',
  departmentId: 'dep-1',
  positionId: null,
  legalDepartmentId: null,
  legalPositionId: null,
  mobilePhone: null,
  city: null,
  officeLocation: null,
  isRemote: false,
  workRate: 1,
  gender: null,
  birthDate: null,
  hiredAt: '2020-01-10',
  workdayStart: null,
  avatarUrl: null,
  roles: [],
  createdAt: '2026-09-24T09:00:00Z',
  updatedAt: '2026-09-24T09:00:00Z',
  ...overrides,
});

describe('buildProfilePatches (#923)', () => {
  it('без изменений патчи пустые', () => {
    const current = card();
    const { selfPatch, adminPatch } = buildProfilePatches(current, draftOf(current), {
      self: true,
      manage: true,
    });
    expect(selfPatch).toEqual({});
    expect(adminPatch).toEqual({});
  });

  it('сотрудник: только self-поля, структура и HR не уходят', () => {
    const current = card();
    const draft = { ...draftOf(current), mobilePhone: '+375291234567', city: 'Минск' };
    const { selfPatch, adminPatch } = buildProfilePatches(current, draft, {
      self: true,
      manage: false,
    });
    expect(selfPatch).toEqual({ mobilePhone: '+375291234567', city: 'Минск' });
    expect(adminPatch).toEqual({});
  });

  it('админ своей карточки: структура и ставка — в admin-патч', () => {
    const current = card();
    const draft = { ...draftOf(current), departmentId: 'dep-2', workRate: '0.5' };
    const { selfPatch, adminPatch } = buildProfilePatches(current, draft, {
      self: true,
      manage: true,
    });
    expect(selfPatch).toEqual({});
    expect(adminPatch).toEqual({ departmentId: 'dep-2', workRate: 0.5 });
  });

  it('админ чужой карточки: всё одной ручкой, включая ФИО', () => {
    const current = card();
    const draft = { ...draftOf(current), lastName: 'Петров', hiredAt: '2021-02-01' };
    const { selfPatch, adminPatch } = buildProfilePatches(current, draft, {
      self: false,
      manage: true,
    });
    expect(selfPatch).toEqual({});
    expect(adminPatch).toEqual({ lastName: 'Петров', hiredAt: '2021-02-01' });
  });

  it('пустой текст нормализуется в null, а не в пустую строку', () => {
    const current = card({ city: 'Минск', middleName: 'Иванович' });
    const draft = { ...draftOf(current), city: '', middleName: '' };
    const { selfPatch } = buildProfilePatches(current, draft, { self: true, manage: false });
    expect(selfPatch).toEqual({ city: null, middleName: null });
  });

  it('руководитель не уходит ни в одном режиме', () => {
    const current = card();
    const draft = { ...draftOf(current), lastName: 'Другой' };
    const { selfPatch, adminPatch } = buildProfilePatches(current, draft, {
      self: false,
      manage: true,
    });
    expect(selfPatch).not.toHaveProperty('managerId');
    expect(adminPatch).not.toHaveProperty('managerId');
  });
});
