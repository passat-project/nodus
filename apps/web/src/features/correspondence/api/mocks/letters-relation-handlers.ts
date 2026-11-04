import type { LetterRef, LetterRelationKind } from '@nodus/contracts';
import { letterRelationCreateBodySchema } from '@nodus/contracts';
import { http, HttpResponse } from 'msw';

import {
  canRegisterLetters,
  canSeeLetter,
  findLetter,
  letterDetailOf,
  letterParentOf,
  letterRefOf,
  pushLetterHistory,
  relationIdOf,
  type DemoLetter,
} from '../../../../shared/mocks/data/letters.js';
import { actorUserRef, getMockActor } from '../../../../shared/mocks/mock-actor.js';
import { apiError, notFound } from './letters-mock-checks.js';

/** Связи писем (#461, Р1/Р1а): постановка/замена/снятие — только канцелярия;
 *  цель — живое зарегистрированное письмо, видимое актору; цикл — 422. */

function linkOf(letter: DemoLetter, kind: LetterRelationKind): LetterRef | null {
  return kind === 'reply_to' ? letter.replyTo : letter.nestedIn;
}

function setLink(letter: DemoLetter, kind: LetterRelationKind, ref: LetterRef | null): void {
  if (kind === 'reply_to') letter.replyTo = ref;
  else letter.nestedIn = ref;
}

/** Цель лежит в цепочке самого письма (идём вверх по родителям цели). */
function createsCycle(letter: DemoLetter, target: DemoLetter): boolean {
  let current: DemoLetter | undefined = target;
  for (let step = 0; step < 64 && current; step += 1) {
    if (current.id === letter.id) return true;
    const parent = letterParentOf(current);
    current = parent ? findLetter(parent.ref.id) : undefined;
  }
  return false;
}

const relationError = (reason: string) =>
  apiError(422, 'LETTER_RELATION_INVALID', { field: 'relatedLetterId', reason });

export const lettersRelationHandlers = [
  http.post('/api/v1/letters/:id/relations', async ({ params, request }) => {
    const actor = getMockActor();
    const letter = findLetter(String(params.id));
    if (!letter || !canSeeLetter(letter, actor)) return notFound();
    if (!canRegisterLetters(actor)) return apiError(403, 'FORBIDDEN');
    const parsed = letterRelationCreateBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError(400, 'VALIDATION_FAILED');
    const { relatedLetterId, kind, replace } = parsed.data;
    const target = findLetter(relatedLetterId);
    if (!target || !canSeeLetter(target, actor)) return relationError('not_found');
    if (target.id === letter.id || createsCycle(letter, target)) return relationError('cycle');
    if (target.registeredAt === null) return relationError('not_registered');
    const current = linkOf(letter, kind);
    if (current?.id === target.id) return HttpResponse.json(letterDetailOf(letter, actor));
    if (current && !replace) return relationError('already_linked');
    setLink(letter, kind, letterRefOf(target));
    pushLetterHistory(letter.id, {
      id: crypto.randomUUID(),
      kind: 'relation_changed',
      at: new Date().toISOString(),
      actor: actorUserRef(),
      action: current ? 'replaced' : 'linked',
      relationKind: kind,
      relatedLetter: letterRefOf(target),
    });
    return HttpResponse.json(letterDetailOf(letter, actor));
  }),

  /** Снятие связи — идемпотентно (204 и когда связи уже нет). */
  http.delete('/api/v1/letters/:id/relations/:relationId', ({ params }) => {
    const actor = getMockActor();
    const letter = findLetter(String(params.id));
    if (!letter || !canSeeLetter(letter, actor)) return notFound();
    if (!canRegisterLetters(actor)) return apiError(403, 'FORBIDDEN');
    for (const kind of ['reply_to', 'nested_in'] as const) {
      const current = linkOf(letter, kind);
      if (!current || relationIdOf(letter.id, kind) !== params.relationId) continue;
      setLink(letter, kind, null);
      pushLetterHistory(letter.id, {
        id: crypto.randomUUID(),
        kind: 'relation_changed',
        at: new Date().toISOString(),
        actor: actorUserRef(),
        action: 'unlinked',
        relationKind: kind,
        relatedLetter: current,
      });
      break;
    }
    return new HttpResponse(null, { status: 204 });
  }),
];
