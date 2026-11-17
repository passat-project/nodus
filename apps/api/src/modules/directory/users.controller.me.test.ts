import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@nodus/contracts';

import { UsersController } from './users.controller.js';

/** Самообслуживание идёт через `UserProfileService` (#923): контроллер не
 *  держит логику профиля, только делегирует; справочные мутации — UsersService. */
describe('UsersController: маршруты /me (#923)', () => {
  const actor: AuthUser = {
    id: 'user-1',
    email: 'me@nodus.by',
    displayName: 'Я',
    permissions: [],
  };
  const usersService = { updateMyProfile: vi.fn() };
  const profileService = {
    updateMyProfile: vi.fn(async () => ({ id: 'user-1' })),
    setMyAvatar: vi.fn(),
    removeMyAvatar: vi.fn(async () => ({ id: 'user-1' })),
  };
  const controller = new UsersController(usersService as never, profileService as never);

  it('PATCH /users/me делегирует в профиль-сервис с id актора', async () => {
    await expect(controller.updateMyProfile(actor, { city: 'Минск' })).resolves.toEqual({
      id: 'user-1',
    });
    expect(profileService.updateMyProfile).toHaveBeenCalledWith('user-1', { city: 'Минск' });
  });

  it('DELETE /users/me/avatar делегирует в профиль-сервис', async () => {
    await expect(controller.removeMyAvatar(actor)).resolves.toEqual({ id: 'user-1' });
    expect(profileService.removeMyAvatar).toHaveBeenCalledWith('user-1');
  });
});
