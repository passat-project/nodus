import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateMyProfileOf } from './users-profile.js';

/** Саморедактирование профиля (#923): displayName — денормализация ФИО,
 *  пересчитывается только когда ФИО реально прислали; правка контактов не
 *  должна откатывать имя, изменённое параллельно (устаревший снимок `before`). */

function cardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'new@nodus.by',
    displayName: 'Новый Сотрудник',
    status: 'active',
    lastName: 'Новый',
    firstName: 'Сотрудник',
    middleName: null,
    managerId: null,
    departmentId: null,
    positionId: null,
    legalDepartmentId: null,
    legalPositionId: null,
    mobilePhone: null,
    city: null,
    officeLocation: null,
    isRemote: false,
    workRate: null,
    gender: null,
    birthDate: null,
    hiredAt: null,
    workdayStart: null,
    avatarUrl: null,
    roles: [] as { role: { id: string; code: string; name: string } }[],
    createdAt: new Date('2026-09-02T00:00:00Z'),
    updatedAt: new Date('2026-09-02T00:00:00Z'),
    ...overrides,
  };
}

describe('updateMyProfileOf: displayName (#923)', () => {
  const users = { findCardById: vi.fn(), update: vi.fn() };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };
  const deps = { users, tx, eventBus, avatarUrlOf: () => null };

  beforeEach(() => {
    vi.resetAllMocks();
    users.findCardById.mockResolvedValue(cardRow());
  });

  it('правка контактов не перезаписывает displayName', async () => {
    await updateMyProfileOf('user-1', { mobilePhone: '+375291234567' }, deps as never);

    expect(users.update).toHaveBeenCalledWith(
      'user-1',
      { mobilePhone: '+375291234567' },
      'tx-handle',
    );
  });

  it('смена имени пересчитывает displayName из ФИО', async () => {
    await updateMyProfileOf('user-1', { firstName: 'Иван' }, deps as never);

    expect(users.update).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ firstName: 'Иван', displayName: 'Новый Иван' }),
      'tx-handle',
    );
  });

  it('событие профиля — в той же транзакции', async () => {
    await updateMyProfileOf('user-1', { city: 'Минск' }, deps as never);

    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.user.updated',
      { userId: 'user-1', changedFields: ['city'] },
      expect.objectContaining({ actorId: 'user-1' }),
    );
  });
});
