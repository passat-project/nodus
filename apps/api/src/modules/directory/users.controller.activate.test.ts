import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { Permission } from '@nodus/contracts';

import { AUDIT_KEY, type AuditMetadata } from '../../core/decorators/audit.decorator.js';
import { PERMISSIONS_KEY } from '../../core/decorators/require-permissions.decorator.js';
import { UsersController } from './users.controller.js';

/**
 * Маршрут активации — зеркало деактивации (AUD-016): то же право
 * `directory.manage`, аудит `directory.user.activate`, тело ответа — карточка;
 * вызов уходит в сервис.
 */
describe('UsersController: POST /directory/users/:id/activate (AUD-016)', () => {
  const handler = UsersController.prototype.activate as (...args: unknown[]) => unknown;

  it('это POST :id/activate', () => {
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(':id/activate');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
  });

  it('право — directory.manage (как у деактивации)', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([Permission.DIRECTORY_MANAGE]);
  });

  it('аудит directory.user.activate по сущности user', () => {
    expect(Reflect.getMetadata(AUDIT_KEY, handler)).toEqual<AuditMetadata>({
      action: 'directory.user.activate',
      entity: 'user',
    });
  });

  it('делегирует в UsersService.activateUser', async () => {
    const usersService = { activateUser: vi.fn(async () => ({ id: 'user-1' })) };
    const controller = new UsersController(usersService as never);
    const actor = { id: 'admin-1', email: 'a@b.by', displayName: 'Админ', permissions: [] };

    await expect(controller.activate('user-1', actor)).resolves.toEqual({ id: 'user-1' });
    expect(usersService.activateUser).toHaveBeenCalledWith('user-1', actor);
  });
});
