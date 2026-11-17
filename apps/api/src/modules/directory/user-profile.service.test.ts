import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@nodus/contracts';

import { UserProfileService } from './user-profile.service.js';

/** Самообслуживание сотрудника (#923): правка своего профиля по allowlist,
 *  пересчёт displayName, событие в той же транзакции; аватар — свой. */

function cardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'me@nodus.by',
    displayName: 'Иванов Иван',
    status: 'active',
    lastName: 'Иванов',
    firstName: 'Иван',
    middleName: 'Иванович',
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
    hiredAt: null,
    workdayStart: null,
    avatarUrl: null,
    roles: [],
    createdAt: new Date('2026-09-02T00:00:00Z'),
    updatedAt: new Date('2026-09-02T00:00:00Z'),
    ...overrides,
  };
}

describe('UserProfileService (#923)', () => {
  const users = { findCardById: vi.fn(), update: vi.fn() };
  const tx = { run: vi.fn((cb: (t: string) => unknown) => cb('tx-handle')) };
  const eventBus = { emit: vi.fn() };
  const signedUrls = { fileContentUrl: vi.fn(() => '/files/x/content') };
  const avatars = { process: vi.fn() };

  let service: UserProfileService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new UserProfileService(
      users as never,
      tx as never,
      eventBus as never,
      signedUrls as never,
      avatars as never,
    );
  });

  it('updateMyProfile: ФИО и контакты, displayName пересчитан, событие в транзакции', async () => {
    users.findCardById
      .mockResolvedValueOnce(cardRow({ city: null }))
      .mockResolvedValueOnce(cardRow({ displayName: 'Иванов Пётр' }));
    users.update.mockResolvedValue(cardRow());

    await service.updateMyProfile('user-1', { firstName: 'Пётр', city: 'Минск' });

    expect(users.update).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ firstName: 'Пётр', city: 'Минск', displayName: 'Иванов Пётр' }),
      'tx-handle',
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.user.updated',
      { userId: 'user-1', changedFields: ['firstName', 'city'] },
      expect.objectContaining({ actorId: 'user-1' }),
    );
  });

  it('updateMyProfile: не найден → NOT_FOUND', async () => {
    users.findCardById.mockResolvedValue(null);

    await expect(service.updateMyProfile('ghost', { city: 'Минск' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it('setMyAvatar: дериват files → fileId сотрудника и событие', async () => {
    avatars.process.mockResolvedValue({ fileId: 'file-1' });
    users.findCardById.mockResolvedValue(cardRow());
    users.update.mockResolvedValue(cardRow());

    await service.setMyAvatar('user-1', { name: 'avatar.png', size: 1000 }, {} as never);

    expect(avatars.process).toHaveBeenCalledWith(
      { ownerId: 'user-1', name: 'avatar.png', size: 1000 },
      expect.anything(),
    );
    expect(users.update).toHaveBeenCalledWith('user-1', { avatarFileId: 'file-1' }, 'tx-handle');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.user.updated',
      { userId: 'user-1', changedFields: ['avatarFileId'] },
      expect.objectContaining({ actorId: 'user-1' }),
    );
  });

  it('setMyAvatar: не найден → NOT_FOUND до обработки файла', async () => {
    users.findCardById.mockResolvedValue(null);

    await expect(
      service.setMyAvatar('ghost', { name: 'a.png', size: 1 }, {} as never),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    expect(avatars.process).not.toHaveBeenCalled();
  });

  it('removeMyAvatar: очищает fileId и эмитит событие', async () => {
    users.findCardById.mockResolvedValue(cardRow({ avatarUrl: '/f/1' }));

    await service.removeMyAvatar('user-1');

    expect(users.update).toHaveBeenCalledWith('user-1', { avatarFileId: null }, 'tx-handle');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'tx-handle',
      'directory.user.updated',
      { userId: 'user-1', changedFields: ['avatarFileId'] },
      expect.objectContaining({ actorId: 'user-1' }),
    );
  });

  it('removeMyAvatar: не найден → NOT_FOUND', async () => {
    users.findCardById.mockResolvedValue(null);

    await expect(service.removeMyAvatar('ghost')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});
