import { describe, expect, it } from 'vitest';

import {
  departmentDeletedPayloadSchema,
  invitationAcceptedPayloadSchema,
  invitationCreatedPayloadSchema,
  invitationExpiredPayloadSchema,
  invitationRevokedPayloadSchema,
  userDeletedPayloadSchema,
  userPasswordChangedPayloadSchema,
  userPasswordResetIssuedPayloadSchema,
} from './directory-events.js';

/** Payload-схемы приглашений (#101): события стабильны для подписчиков. */
describe('directory events: приглашения (#101)', () => {
  it('created/accepted/revoked/expired разбираются', () => {
    expect(
      invitationCreatedPayloadSchema.parse({
        userId: '11111111-1111-4111-8111-111111111111',
        email: 'new@nodus.by',
        expiresAt: new Date().toISOString(),
      }),
    ).toBeTruthy();
    expect(
      invitationAcceptedPayloadSchema.parse({
        userId: '11111111-1111-4111-8111-111111111111',
        email: 'new@nodus.by',
      }),
    ).toBeTruthy();
    expect(
      invitationRevokedPayloadSchema.parse({
        userId: '11111111-1111-4111-8111-111111111111',
        reason: 'expired',
      }),
    ).toBeTruthy();
    expect(
      invitationExpiredPayloadSchema.parse({
        userId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toBeTruthy();
  });

  it('удаление подразделения несёт имя, родителя, детей и сотрудников (#881)', () => {
    expect(
      departmentDeletedPayloadSchema.parse({
        departmentId: '11111111-1111-4111-8111-111111111111',
        name: 'BIM-отдел',
        parentId: '22222222-2222-4222-8222-222222222222',
        childDepartmentIds: ['33333333-3333-4333-8333-333333333333'],
        userIds: ['44444444-4444-4444-8444-444444444444'],
      }),
    ).toBeTruthy();
  });

  it('удаление и парольные события разбираются', () => {
    expect(
      userDeletedPayloadSchema.parse({ userId: '11111111-1111-4111-8111-111111111111' }),
    ).toBeTruthy();
    expect(
      userPasswordResetIssuedPayloadSchema.parse({
        userId: '11111111-1111-4111-8111-111111111111',
        byAdminId: '22222222-2222-4222-8222-222222222222',
      }),
    ).toBeTruthy();
    expect(
      userPasswordChangedPayloadSchema.parse({
        userId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toBeTruthy();
  });
});
