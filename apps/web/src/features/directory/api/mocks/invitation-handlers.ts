import { http, HttpResponse } from 'msw';
import type { Department, Position, UserCard, UserListItem } from '@nodus/contracts';
import {
  acceptInvitationSchema,
  acceptPasswordResetSchema,
  createInvitationSchema,
  ErrorCode,
} from '@nodus/contracts';

import {
  patchRuntimeUser,
  rememberRuntimeUser,
  removeRuntimeUser,
} from '../../../../shared/mocks/data/runtime-users.js';
import { createInvitationTokenState } from './invitation-token-state.js';

/** Состояние directory-мока для приглашений (#101): список, карточки и
 *  справочники живут в `directory-handlers.ts`; фабрика получает геттеры. */
export interface InvitationMockState {
  getUserState: () => UserListItem[];
  setUserState: (items: UserListItem[]) => void;
  cards: UserCard[];
  getDepartments: () => Department[];
  getPositions: () => Position[];
}

export function invitationHandlers(state: InvitationMockState) {
  const tokens = createInvitationTokenState();

  return [
    http.post('/api/v1/directory/invitations', async ({ request }) => {
      const parsed = createInvitationSchema.safeParse(await request.json());
      if (!parsed.success) {
        return HttpResponse.json(
          { code: 'VALIDATION_FAILED', message: 'Invalid invitation payload' },
          { status: 400 },
        );
      }
      const email = parsed.data.email.trim().toLowerCase();
      if (state.getUserState().some((user) => user.email.toLowerCase() === email)) {
        return HttpResponse.json(
          { code: ErrorCode.DIRECTORY_EMAIL_TAKEN, message: 'Email already exists' },
          { status: 409 },
        );
      }
      const department = state
        .getDepartments()
        .find(
          (entry) =>
            entry.id === parsed.data.departmentId && entry.kind === 'management' && entry.isActive,
        );
      const position = state
        .getPositions()
        .find((entry) => entry.id === parsed.data.positionId && entry.kind === 'management');
      if (!department || !position) {
        return HttpResponse.json(
          { code: ErrorCode.DIRECTORY_REFERENCE_INVALID, message: 'Invalid reference' },
          { status: 400 },
        );
      }
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const displayName = [parsed.data.lastName, parsed.data.firstName, parsed.data.middleName]
        .filter((part): part is string => Boolean(part))
        .join(' ');
      const template = state.cards[0]!;
      const card: UserCard = {
        ...template,
        id,
        email,
        lastName: parsed.data.lastName,
        firstName: parsed.data.firstName,
        middleName: parsed.data.middleName,
        displayName,
        status: 'invited',
        avatarUrl: null,
        managerId: null,
        departmentId: department.id,
        positionId: position.id,
        legalDepartmentId: null,
        legalPositionId: null,
        roles: [],
        invitedAt: now,
        activatedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      state.cards.push(card);
      state.setUserState([
        {
          id,
          displayName,
          status: 'invited',
          avatarUrl: null,
          positionName: position.name,
          departmentName: department.name,
          email,
          managerId: null,
          departmentId: department.id,
          legalDepartmentId: null,
          positionId: position.id,
          legalPositionId: null,
        },
        ...state.getUserState(),
      ]);
      rememberRuntimeUser({ id, email, displayName, status: 'invited' });
      return HttpResponse.json(tokens.issueToken(id, email, 'invite'), { status: 201 });
    }),

    http.post('/api/v1/directory/invitations/:id/reissue', ({ params }) => {
      const card = state.cards.find(
        (user) => user.id === String(params.id) && user.status === 'invited',
      );
      if (!card) {
        return HttpResponse.json(
          { code: ErrorCode.CONFLICT, message: 'Invitation not found' },
          { status: 409 },
        );
      }
      return HttpResponse.json(tokens.issueToken(card.id, card.email, 'invite'));
    }),

    http.delete('/api/v1/directory/invitations/:id', ({ params }) => {
      const id = String(params.id);
      const card = state.cards.find((user) => user.id === id && user.status === 'invited');
      if (!card) {
        return HttpResponse.json(
          { code: ErrorCode.CONFLICT, message: 'Invitation not found' },
          { status: 409 },
        );
      }
      state.cards.splice(state.cards.indexOf(card), 1);
      state.setUserState(state.getUserState().filter((user) => user.id !== id));
      removeRuntimeUser(id);
      tokens.revokeForUser(id);
      return new HttpResponse(null, { status: 204 });
    }),

    http.post('/api/v1/directory/users/:id/password-reset', ({ params }) => {
      const card = state.cards.find((user) => user.id === String(params.id));
      if (!card || card.status === 'invited') {
        return HttpResponse.json(
          { code: ErrorCode.CONFLICT, message: 'Password reset is not available' },
          { status: 409 },
        );
      }
      return HttpResponse.json(tokens.issueToken(card.id, card.email, 'reset'));
    }),

    http.get('/api/v1/invitations/:token', ({ params }) => {
      const entry = tokens.tokenOrError(String(params.token), 'invite');
      if (entry instanceof HttpResponse) return entry;
      const card = state.cards.find((user) => user.id === entry.userId);
      if (!card) {
        return HttpResponse.json(
          { code: ErrorCode.INVITATION_INVALID, message: 'Invitation not found' },
          { status: 400 },
        );
      }
      const department = state.getDepartments().find((item) => item.id === card.departmentId);
      const position = state.getPositions().find((item) => item.id === card.positionId);
      return HttpResponse.json({
        kind: 'invite',
        displayName: card.displayName,
        email: card.email,
        departmentName: department?.name ?? null,
        positionName: position?.name ?? null,
        expiresAt: entry.expiresAt,
      });
    }),

    http.post('/api/v1/invitations/:token/accept', async ({ request, params }) => {
      const parsed = acceptInvitationSchema.safeParse(await request.json());
      if (!parsed.success) {
        return HttpResponse.json(
          { code: 'VALIDATION_FAILED', message: 'Invalid password payload' },
          { status: 400 },
        );
      }
      const entry = tokens.tokenOrError(String(params.token), 'invite');
      if (entry instanceof HttpResponse) return entry;
      const card = state.cards.find((user) => user.id === entry.userId);
      if (!card) {
        return HttpResponse.json(
          { code: ErrorCode.INVITATION_INVALID, message: 'Invitation not found' },
          { status: 400 },
        );
      }
      if (card.email.toLowerCase() !== parsed.data.email.toLowerCase()) {
        return HttpResponse.json(
          { code: ErrorCode.INVITATION_EMAIL_MISMATCH, message: 'Email mismatch' },
          { status: 400 },
        );
      }
      const now = new Date().toISOString();
      entry.usedAt = now;
      card.status = 'active';
      card.activatedAt = now;
      card.updatedAt = now;
      state.setUserState(
        state
          .getUserState()
          .map((user) => (user.id === card.id ? { ...user, status: 'active' as const } : user)),
      );
      patchRuntimeUser(card.id, { status: 'active' });
      return HttpResponse.json({ id: card.id, email: card.email });
    }),

    http.get('/api/v1/password-resets/:token', ({ params }) => {
      const entry = tokens.tokenOrError(String(params.token), 'reset');
      if (entry instanceof HttpResponse) return entry;
      const card = state.cards.find((user) => user.id === entry.userId);
      if (!card) {
        return HttpResponse.json(
          { code: ErrorCode.PASSWORD_RESET_INVALID, message: 'Reset not found' },
          { status: 400 },
        );
      }
      return HttpResponse.json({
        kind: 'reset',
        displayName: card.displayName,
        email: card.email,
        expiresAt: entry.expiresAt,
      });
    }),

    http.post('/api/v1/password-resets/:token/accept', async ({ request, params }) => {
      const parsed = acceptPasswordResetSchema.safeParse(await request.json());
      if (!parsed.success) {
        return HttpResponse.json(
          { code: 'VALIDATION_FAILED', message: 'Invalid password payload' },
          { status: 400 },
        );
      }
      const entry = tokens.tokenOrError(String(params.token), 'reset');
      if (entry instanceof HttpResponse) return entry;
      const card = state.cards.find((user) => user.id === entry.userId);
      if (!card) {
        return HttpResponse.json(
          { code: ErrorCode.PASSWORD_RESET_INVALID, message: 'Reset not found' },
          { status: 400 },
        );
      }
      if (card.email.toLowerCase() !== parsed.data.email.toLowerCase()) {
        return HttpResponse.json(
          { code: ErrorCode.INVITATION_EMAIL_MISMATCH, message: 'Email mismatch' },
          { status: 400 },
        );
      }
      const now = new Date().toISOString();
      entry.usedAt = now;
      card.status = 'active';
      card.activatedAt = card.activatedAt ?? now;
      card.updatedAt = now;
      state.setUserState(
        state
          .getUserState()
          .map((user) => (user.id === card.id ? { ...user, status: 'active' as const } : user)),
      );
      patchRuntimeUser(card.id, { status: 'active' });
      return HttpResponse.json({ id: card.id, email: card.email });
    }),
  ];
}
