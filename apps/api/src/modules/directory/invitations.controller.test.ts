import { describe, expect, it, vi } from 'vitest';

import { InvitationsController } from './invitations.controller.js';
import { PublicInvitationsController } from './public-invitations.controller.js';

/** Тонкие HTTP-хендлеры приглашений (#101): права/аудит — декораторами,
 *  сервисные сценарии — в сервисах; здесь проверяем проводку. */
describe('контроллеры приглашений (#101)', () => {
  const invitations = {
    createInvitation: vi.fn(async () => ({ id: 'user-1' })),
    reissueInvitation: vi.fn(async () => ({ id: 'user-1' })),
    cancelInvitation: vi.fn(async () => undefined),
    issuePasswordReset: vi.fn(async () => ({ id: 'user-1' })),
  };
  const accept = {
    invitationInfo: vi.fn(async () => ({ kind: 'invite' })),
    acceptInvitation: vi.fn(async () => ({ id: 'user-1' })),
    passwordResetInfo: vi.fn(async () => ({ kind: 'reset' })),
    acceptPasswordReset: vi.fn(async () => ({ id: 'user-1' })),
  };
  const actor = { id: 'admin-1', email: 'a@b.by', displayName: 'Админ', permissions: [] };
  const dto = {
    email: 'new@nodus.by',
    lastName: 'Новиков',
    firstName: 'Иван',
    middleName: null,
    positionId: 'p1',
    departmentId: 'd1',
  };

  it('админские маршруты вызывают сервис с актором', async () => {
    const controller = new InvitationsController(invitations as never);
    await controller.create(dto, actor);
    await controller.reissue('user-1', actor);
    await controller.cancel('user-1', actor);
    await controller.issuePasswordReset('user-1', actor);
    expect(invitations.createInvitation).toHaveBeenCalledWith(dto, actor);
    expect(invitations.reissueInvitation).toHaveBeenCalledWith('user-1', actor);
    expect(invitations.cancelInvitation).toHaveBeenCalledWith('user-1', actor);
    expect(invitations.issuePasswordReset).toHaveBeenCalledWith('user-1', actor);
  });

  it('публичные маршруты вызывают сервис принятия', async () => {
    const controller = new PublicInvitationsController(accept as never);
    await controller.invitationInfo('token-1');
    await controller.acceptInvitation('token-1', {
      email: 'new@nodus.by',
      password: 'Strong!Pass123',
    });
    await controller.passwordResetInfo('token-2');
    await controller.acceptPasswordReset('token-2', {
      email: 'new@nodus.by',
      password: 'Strong!Pass123',
    });
    expect(accept.invitationInfo).toHaveBeenCalledWith('token-1');
    expect(accept.acceptInvitation).toHaveBeenCalledWith('token-1', {
      email: 'new@nodus.by',
      password: 'Strong!Pass123',
    });
    expect(accept.passwordResetInfo).toHaveBeenCalledWith('token-2');
    expect(accept.acceptPasswordReset).toHaveBeenCalledWith('token-2', expect.any(Object));
  });
});
