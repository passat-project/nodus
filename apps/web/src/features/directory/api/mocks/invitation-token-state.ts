import { HttpResponse } from 'msw';
import { ErrorCode } from '@nodus/contracts';

/** Одноразовые токены мок-мира приглашений (#101): в памяти воркера,
 *  одноразовые, с TTL; серверный аналог хранит только хеш. */
export type MockTokenKind = 'invite' | 'reset';

export interface MockToken {
  userId: string;
  email: string;
  kind: MockTokenKind;
  expiresAt: string;
  usedAt: string | null;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 24 * 60 * 60 * 1000;

export function createInvitationTokenState() {
  const tokens = new Map<string, MockToken>();

  function issueToken(userId: string, email: string, kind: MockTokenKind) {
    for (const [key, value] of tokens) {
      if (value.userId === userId && value.kind === kind && value.usedAt === null) {
        tokens.delete(key);
      }
    }
    const token = `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
    const expiresAt = new Date(
      Date.now() + (kind === 'invite' ? INVITE_TTL_MS : RESET_TTL_MS),
    ).toISOString();
    tokens.set(token, { userId, email, kind, expiresAt, usedAt: null });
    return {
      id: userId,
      token,
      path: `/${kind === 'invite' ? 'invite' : 'reset'}/${token}`,
      expiresAt,
    };
  }

  function tokenOrError(token: string, kind: MockTokenKind) {
    const entry = tokens.get(token);
    if (!entry || entry.kind !== kind) {
      return HttpResponse.json(
        { code: ErrorCode.INVITATION_INVALID, message: 'Invalid token' },
        { status: 400 },
      );
    }
    if (entry.usedAt !== null) {
      return HttpResponse.json(
        { code: ErrorCode.INVITATION_ALREADY_USED, message: 'Token already used' },
        { status: 409 },
      );
    }
    if (Date.parse(entry.expiresAt) <= Date.now()) {
      return HttpResponse.json(
        { code: ErrorCode.INVITATION_INVALID, message: 'Token expired' },
        { status: 400 },
      );
    }
    return entry;
  }

  function revokeForUser(userId: string): void {
    for (const [token, entry] of tokens) {
      if (entry.userId === userId) tokens.delete(token);
    }
  }

  return { issueToken, tokenOrError, revokeForUser };
}
