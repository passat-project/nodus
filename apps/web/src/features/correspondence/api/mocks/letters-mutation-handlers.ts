import type { LetterAttachment } from '@nodus/contracts';
import {
  LETTER_LIMITS,
  createLetterFieldsSchema,
  isFinalState,
  updateLetterBodySchema,
} from '@nodus/contracts';
import { http, HttpResponse } from 'msw';

import { demoConversations } from '../../../../shared/mocks/data/chat.js';
import { counterpartyRefById } from '../../../../shared/mocks/data/counterparties.js';
import { applyDemoPatch } from '../../../../shared/mocks/data/custom-fields-rules.js';
import { incomingLetterType, letterStages } from '../../../../shared/mocks/data/letter-catalog.js';
import { previewKindOf } from '../../../../shared/mocks/data/letter-files.js';
import {
  boxOf,
  canRegisterLetters,
  canSeeLetter,
  demoLetters,
  findLetter,
  letterDetailOf,
  letterHistory,
  letterMemberIds,
  pushLetterHistory,
  viewedLetterIds,
  type DemoLetter,
} from '../../../../shared/mocks/data/letters.js';
import { demoUserListItems } from '../../../../shared/mocks/data/users.js';
import { actorUserRef, getMockActor } from '../../../../shared/mocks/mock-actor.js';
import {
  apiError,
  attachedRefsOf,
  contactRefOf,
  letterFieldsIssue,
  notFound,
  patchChanges,
  projectRefOf,
  receiptMethodRefOf,
} from './letters-mock-checks.js';

/** Мутации писем (#55, §6.2): ручное создание (multipart: поля, затем
 *  файлы `files`), правка регистрационных данных, удаление спама,
 *  присоединение к обсуждению. Тела — схемы contracts. */

/** Ссылка на загруженный файл: в браузере — blob (вьювер покажет сам файл),
 *  в тестах (без createObjectURL) — заглушка ассета. */
function uploadedUrl(file: File): string {
  return typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(file)
    : `/demo/letters/${encodeURIComponent(file.name)}`;
}

function attachmentOf(file: File, role: LetterAttachment['role']): LetterAttachment {
  const mime = file.type || 'application/octet-stream';
  return {
    id: crypto.randomUUID(),
    fileId: crypto.randomUUID(),
    role,
    name: file.name,
    mime,
    size: file.size,
    contentId: null,
    inline: false,
    url: uploadedUrl(file),
    pdfUrl: null,
    previewKind: previewKindOf(file.name, mime),
  };
}

export const lettersMutationHandlers = [
  /** Ручное создание входящего в «Новое» (бумага: скан + приложения). */
  http.post('/api/v1/letters', async ({ request }) => {
    const actor = getMockActor();
    if (!canRegisterLetters(actor)) return apiError(403, 'FORBIDDEN');
    const form = await request.formData();
    const fields = createLetterFieldsSchema.safeParse({
      typeId: form.get('typeId'),
      mainIndex: form.get('mainIndex') ?? undefined,
    });
    const files = form.getAll('files').filter((entry): entry is File => entry instanceof File);
    if (!fields.success || files.length === 0 || files.length > LETTER_LIMITS.files) {
      return apiError(422, 'VALIDATION_FAILED');
    }
    if (files.some((file) => file.size > LETTER_LIMITS.fileBytes)) {
      return apiError(413, 'VALIDATION_FAILED');
    }
    if (fields.data.typeId !== incomingLetterType.id) return apiError(422, 'VALIDATION_FAILED');
    const mainIndex = Math.min(fields.data.mainIndex, files.length - 1);
    const attachments = files.map((file, index) =>
      attachmentOf(file, index === mainIndex ? 'main' : 'attachment'),
    );
    const main = attachments[mainIndex]!;
    const now = new Date().toISOString();
    const letter: DemoLetter = {
      id: crypto.randomUUID(),
      typeId: incomingLetterType.id,
      direction: 'incoming',
      stage: letterStages.new,
      regNumber: null,
      regDate: null,
      registeredAt: null,
      receivedAt: now,
      source: 'manual',
      subject: null,
      counterparty: null,
      theirNumber: null,
      theirDate: null,
      receiptMethod: null,
      project: null,
      addressee: null,
      responseDeadline: null,
      signer: null,
      registrar: null,
      mail: null,
      replyTo: null,
      nestedIn: null,
      attachedRefs: [],
      confidential: false,
      replySuggestion: null,
      attachments,
      body: { kind: 'document', attachmentId: main.id },
      customFields: {},
      participantIds: [],
      createdById: actor.id,
    };
    demoLetters.unshift(letter);
    letterHistory.set(letter.id, [
      {
        id: crypto.randomUUID(),
        kind: 'received',
        at: now,
        actor: actorUserRef(),
        source: 'manual',
      },
    ]);
    return HttpResponse.json(letterDetailOf(letter, actor), { status: 201 });
  }),

  /** Правка реквизитов (В3, Р11; редизайн #56 — и незарегистрированного из
   *  карточки-формы; адресат — только до регистрации): та же проверка полей,
   *  что при регистрации; журнал — изменения. */
  http.patch('/api/v1/letters/:id', async ({ params, request }) => {
    const actor = getMockActor();
    const letter = findLetter(String(params.id));
    if (!letter || !canSeeLetter(letter, actor)) return notFound();
    if (!canRegisterLetters(actor)) return apiError(403, 'FORBIDDEN');
    if (isFinalState(letter.stage.systemState)) return apiError(409, 'LETTER_NOT_EDITABLE');
    const parsed = updateLetterBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError(400, 'VALIDATION_FAILED');
    const body = parsed.data;
    // Адресат меняется только до регистрации (редизайн #56).
    if (letter.registeredAt !== null && body.addresseeId !== undefined) {
      return apiError(409, 'LETTER_NOT_EDITABLE');
    }
    const counterpartyId = body.counterpartyId ?? letter.counterparty?.id ?? '';
    const signerId = body.signerId !== undefined ? body.signerId : (letter.signer?.id ?? null);
    const issue = await letterFieldsIssue(
      {
        counterpartyId,
        signerId,
        theirDate: body.theirDate,
        responseDeadline: body.responseDeadline,
        receiptMethodId: body.receiptMethodId ?? letter.receiptMethod?.id ?? '',
        customFields: body.customFields,
      },
      request,
    );
    if (issue) return apiError(422, 'LETTER_REGISTRATION_INVALID', issue);
    const addresseeId = body.addresseeId !== undefined ? body.addresseeId : null;
    const addresseeUser = addresseeId
      ? demoUserListItems.find((user) => user.id === addresseeId && user.status === 'active')
      : null;
    if (addresseeId && !addresseeUser) {
      return apiError(422, 'LETTER_REGISTRATION_INVALID', {
        field: 'addresseeId',
        reason: 'inactive',
      });
    }
    // «Приложенные письма» (#461): организация обязательна, дубли — 422.
    const attached = body.attachedRefs !== undefined ? attachedRefsOf(body.attachedRefs) : null;
    if (attached && 'issue' in attached) {
      return apiError(422, 'LETTER_REGISTRATION_INVALID', attached.issue);
    }
    const next = {
      counterparty: counterpartyRefById(counterpartyId) ?? letter.counterparty,
      signer: contactRefOf(counterpartyId, signerId),
      receiptMethod: body.receiptMethodId
        ? receiptMethodRefOf(body.receiptMethodId)
        : letter.receiptMethod,
      project: body.projectId !== undefined ? projectRefOf(body.projectId) : letter.project,
      addressee:
        body.addresseeId !== undefined
          ? addresseeUser
            ? {
                id: addresseeUser.id,
                displayName: addresseeUser.displayName,
                avatarUrl: addresseeUser.avatarUrl,
              }
            : null
          : letter.addressee,
    };
    const changes = patchChanges(letter, body, next);
    Object.assign(letter, next, {
      theirNumber: body.theirNumber ?? letter.theirNumber,
      theirDate: body.theirDate ?? letter.theirDate,
      subject: body.subject ?? letter.subject,
      responseDeadline:
        body.responseDeadline !== undefined ? body.responseDeadline : letter.responseDeadline,
      customFields: body.customFields
        ? applyDemoPatch('letter', letter.customFields, body.customFields).next
        : letter.customFields,
      confidential: body.confidential ?? letter.confidential,
      attachedRefs: attached && 'refs' in attached ? attached.refs : letter.attachedRefs,
    });
    if (changes.length > 0) {
      pushLetterHistory(letter.id, {
        id: crypto.randomUUID(),
        kind: 'updated',
        at: new Date().toISOString(),
        actor: actorUserRef(),
        changes: changes.slice(0, LETTER_LIMITS.changes),
      });
    }
    const conversation = demoConversations.find((c) => c.letter?.id === letter.id);
    if (conversation?.letter) conversation.letter.subject = letter.subject;
    return HttpResponse.json(letterDetailOf(letter, actor));
  }),

  /** Удаление спама (Р12): только из «Новых», физически, без следа содержимого. */
  http.delete('/api/v1/letters/:id', ({ params }) => {
    const actor = getMockActor();
    const letter = findLetter(String(params.id));
    if (!letter || !canSeeLetter(letter, actor)) return notFound();
    if (!canRegisterLetters(actor)) return apiError(403, 'FORBIDDEN');
    if (boxOf(letter) !== 'new') return apiError(409, 'LETTER_NOT_DELETABLE');
    demoLetters.splice(demoLetters.indexOf(letter), 1);
    letterHistory.delete(letter.id);
    return new HttpResponse(null, { status: 204 });
  }),

  /** «Присоединиться к обсуждению» (Р10; редизайн #56 — канцелярия может и
   *  до регистрации): участник со звуком, идемпотентно. */
  http.post('/api/v1/letters/:id/join', ({ params }) => {
    const actor = getMockActor();
    const letter = findLetter(String(params.id));
    if (!letter || !canSeeLetter(letter, actor)) return notFound();
    if (!letterMemberIds(letter).includes(actor.id)) {
      letter.participantIds.push(actor.id);
      pushLetterHistory(letter.id, {
        id: crypto.randomUUID(),
        kind: 'participant_joined',
        at: new Date().toISOString(),
        actor: actorUserRef(),
      });
      const conversation = demoConversations.find((c) => c.letter?.id === letter.id);
      if (conversation && !conversation.membersPreview.some((m) => m.id === actor.id)) {
        conversation.membersPreview.push(actorUserRef());
        conversation.membersCount += 1;
      }
    }
    return HttpResponse.json(letterDetailOf(letter, actor));
  }),

  /** «Я открывал» (редизайн #56): идемпотентно, точка в «Новых» гаснет. */
  http.post('/api/v1/letters/:id/view', ({ params }) => {
    const letter = findLetter(String(params.id));
    if (!letter || !canSeeLetter(letter, getMockActor())) return notFound();
    viewedLetterIds.add(letter.id);
    return new HttpResponse(null, { status: 204 });
  }),

  /** Пригласить коллегу в обсуждение (редизайн #56): право регистрации,
   *  любое состояние письма, идемпотентно. */
  http.post('/api/v1/letters/:id/participants', async ({ params, request }) => {
    const actor = getMockActor();
    const letter = findLetter(String(params.id));
    if (!letter || !canSeeLetter(letter, actor)) return notFound();
    if (!canRegisterLetters(actor)) return apiError(403, 'FORBIDDEN');
    const body = (await request.json().catch(() => null)) as { userId?: string } | null;
    const user = demoUserListItems.find((entry) => entry.id === body?.userId);
    if (!user || user.status !== 'active') return apiError(422, 'VALIDATION_FAILED');
    if (!letter.participantIds.includes(user.id)) {
      letter.participantIds.push(user.id);
      pushLetterHistory(letter.id, {
        id: crypto.randomUUID(),
        kind: 'participant_joined',
        at: new Date().toISOString(),
        actor: { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl },
      });
      const conversation = demoConversations.find((c) => c.letter?.id === letter.id);
      if (conversation && !conversation.membersPreview.some((m) => m.id === user.id)) {
        conversation.membersPreview.push({
          id: user.id,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        });
        conversation.membersCount += 1;
      }
    }
    return HttpResponse.json(letterDetailOf(letter, actor));
  }),
];
