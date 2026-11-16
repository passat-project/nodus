// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Permission, letterDetailSchema } from '@nodus/contracts';
import { setupServer } from 'msw/node';

import { useAuthStore } from '../../../../shared/auth-store.js';
import {
  canSeeLetter,
  demoLetters,
  findLetter,
  letterHistory,
  letterMemberIds,
  type DemoLetter,
} from '../../../../shared/mocks/data/letters.js';
import { demoUserListItems } from '../../../../shared/mocks/data/users.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { lettersMutationHandlers } from './letters-mutation-handlers.js';

/**
 * AUD-031: мок приглашения в обсуждение письма принимает контракт
 * `{ userIds: uuid[] }` и ведёт себя как сервер — несколько приглашённых,
 * идемпотентность, 422 на тело не по контракту.
 */
const server = setupServer(...lettersMutationHandlers);
const usedLetters = new Set<string>();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 't',
    user: {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'office@nodus.by',
      displayName: 'Канцелярия',
      permissions: [Permission.CORRESPONDENCE_REGISTER],
    },
  });
});

function freshLetter(): DemoLetter {
  const actor = getMockActor();
  const letter = demoLetters.find(
    (entry) =>
      entry.registeredAt !== null &&
      !entry.confidential &&
      canSeeLetter(entry, actor) &&
      !usedLetters.has(entry.id),
  );
  if (!letter) throw new Error('Нет свободного письма для сценария');
  usedLetters.add(letter.id);
  return letter;
}

/** Двое активных сотрудников, ещё не участников этого письма. */
function inviteesOf(letter: DemoLetter): [string, string] {
  const taken = new Set([...letterMemberIds(letter), getMockActor().id]);
  const candidates = demoUserListItems
    .filter((user) => user.status === 'active' && !taken.has(user.id))
    .map((user) => user.id);
  return [candidates[0]!, candidates[1]!];
}

function invite(letterId: string, body: unknown) {
  return fetch(`/api/v1/letters/${letterId}/participants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('мок POST /letters/:id/participants (AUD-031)', () => {
  it('приглашает двух коллег по контракту — оба появляются среди участников', async () => {
    const letter = freshLetter();
    const invitees = inviteesOf(letter);

    const response = await invite(letter.id, { userIds: invitees });

    expect(response.status).toBe(200);
    expect(letterDetailSchema.safeParse(await response.json()).success).toBe(true);
    const members = letterMemberIds(findLetter(letter.id)!);
    expect(members).toContain(invitees[0]);
    expect(members).toContain(invitees[1]);
  });

  it('повторное приглашение не создаёт дублей участников и истории', async () => {
    const letter = freshLetter();
    const invitees = inviteesOf(letter);
    await invite(letter.id, { userIds: invitees });
    const historyAfterFirst = letterHistory.get(letter.id)?.length ?? 0;

    const second = await invite(letter.id, { userIds: invitees });
    expect(second.status).toBe(200);

    const participants = findLetter(letter.id)!.participantIds;
    for (const id of invitees) expect(participants.filter((entry) => entry === id)).toHaveLength(1);
    expect(letterHistory.get(letter.id)?.length ?? 0).toBe(historyAfterFirst);
  });

  it('тело не по контракту — 422, как на сервере', async () => {
    const letter = freshLetter();
    const [invitee] = inviteesOf(letter);

    // Прежняя форма одиночного поля больше не принимается.
    expect((await invite(letter.id, { userId: invitee })).status).toBe(422);
    // Пустой список не проходит контракт 1–20.
    expect((await invite(letter.id, { userIds: [] })).status).toBe(422);
    // Несуществующий/неактивный сотрудник — отказ целиком.
    expect(
      (await invite(letter.id, { userIds: ['00000000-0000-4000-8000-000000000000'] })).status,
    ).toBe(422);
  });
});
