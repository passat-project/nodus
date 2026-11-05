import type {
  ExecuteTransitionBody,
  WorkflowCondition,
  WorkflowTransition,
} from '@nodus/contracts';
import { effectiveWindowSections, executeTransitionBodySchema } from '@nodus/contracts';
import { http, HttpResponse } from 'msw';

import { demoConversations, demoMessages } from '../../../../shared/mocks/data/chat.js';
import { counterpartyRefById } from '../../../../shared/mocks/data/counterparties.js';
import { applyDemoPatch } from '../../../../shared/mocks/data/custom-fields-rules.js';
import { letterDocumentOf } from '../../../../shared/mocks/data/letter-catalog.js';
import {
  canSeeLetter,
  findLetter,
  letterDetailOf,
  letterMemberIds,
  localIsoDate,
  nextLetterNumber,
  pushLetterHistory,
  type DemoLetter,
  type LetterActor,
} from '../../../../shared/mocks/data/letters.js';
import { userRef } from '../../../../shared/mocks/data/users.js';
import { actorUserRef, getMockActor } from '../../../../shared/mocks/mock-actor.js';
import {
  apiError,
  attachedRefsOf,
  contactRefOf,
  letterFieldsIssue,
  letterRelationIssue,
  notFound,
  projectRefOf,
  receiptMethodRefOf,
  registrationIssueOf,
} from './letters-mock-checks.js';

/** Мок-движок переходов письма (#55, Р1/Р5): кнопки маршрута типа с
 *  условиями-правами и ролями письма, окно (регистрация / причина), номер
 *  серии пост-действием `assign_number`, журнал и блок причины в чате. */

function holdsRole(letter: DemoLetter, actor: LetterActor, role: string): boolean {
  switch (role) {
    case 'registrar':
      return letter.registrar?.id === actor.id;
    case 'addressee':
      return letter.addressee?.id === actor.id;
    case 'participant':
      return letter.participantIds.includes(actor.id);
    case 'author':
      return letter.direction === 'outgoing' && letter.createdById === actor.id;
    default:
      return false;
  }
}

function passes(condition: WorkflowCondition, letter: DemoLetter, actor: LetterActor): boolean {
  switch (condition.kind) {
    case 'permission':
      return actor.permissions.includes(condition.permission);
    case 'role_in':
      return condition.roles.some((role) => holdsRole(letter, actor, role));
    // Письма источников решающих не поддерживают (#433): публикация их
    // запрещает, в демо-маршрутах их нет.
    case 'decider_in':
      return false;
  }
}

export function letterTransitionsOf(letter: DemoLetter, actor: LetterActor): WorkflowTransition[] {
  const route = letterDocumentOf(letter.typeId);
  return route.transitions
    .filter((t) => t.fromStageId === letter.stage.id)
    .filter((t) => t.rules.conditions.every((c) => passes(c, letter, actor)))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((t) => {
      const target = route.stages.find((s) => s.id === t.toStageId)!;
      return {
        id: t.id,
        name: t.name,
        toStageId: t.toStageId,
        toStageName: target.name,
        toStageState: target.systemState,
        toStageOutcome: target.outcome,
        toStageColor: target.color,
        toStageOrder: target.sortOrder,
        display: t.display,
        intent: t.intent,
        blockedBy: [],
        canOverride: false,
        form: t.form.enabled ? t.form : null,
        validators: t.rules.validators,
      };
    });
}

/** Недостающие разделы окна (422 WORKFLOW_TRANSITION_FORM_INVALID). */
function missingSections(transition: WorkflowTransition, body: ExecuteTransitionBody): string[] {
  const form = body.form ?? {};
  return effectiveWindowSections(transition.form, { validators: transition.validators }).flatMap(
    (section) => {
      if (section.kind === 'registration' && !form.registration) return ['registration'];
      if (section.kind === 'comment' && section.required && !form.comment?.trim()) {
        return ['comment'];
      }
      return [];
    },
  );
}

/** Блок причины в чате письма (как #380): беседы нет или состав пуст — нет. */
function postLetterBlock(
  letter: DemoLetter,
  transition: WorkflowTransition,
  fromStageName: string,
  comment: string,
): void {
  const conversation = demoConversations.find((c) => c.letter?.id === letter.id);
  if (!conversation || letterMemberIds(letter).length === 0) return;
  const recordId = crypto.randomUUID();
  const now = new Date().toISOString();
  demoMessages.push({
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    seq: Math.max(0, ...demoMessages.map((m) => m.seq)) + 1,
    clientMessageId: `letter-transition:${recordId}`,
    author: actorUserRef(),
    text: comment,
    kind: 'letter_transition',
    block: {
      kind: 'letter_transition',
      letterId: letter.id,
      recordId,
      transitionName: transition.name.slice(0, 32),
      fromStageName: fromStageName.slice(0, 40),
      toStageName: transition.toStageName.slice(0, 40),
      toStageColor: transition.toStageColor,
      commentLabel: transition.form?.sections.find((s) => s.kind === 'comment')?.label ?? null,
    },
    replyToId: null,
    reply: null,
    threadRootId: null,
    threadRepliesCount: 0,
    reactions: [],
    attachments: [],
    editedAt: null,
    deletedAt: null,
    pinned: false,
    forwardedFrom: null,
    readAt: null,
    readBy: [],
    urgent: false,
    mentionedUserIds: [],
    linkPreview: null,
    createdAt: now,
  });
  conversation.lastMessage = demoMessages[demoMessages.length - 1] ?? null;
}

export const lettersTransitionHandlers = [
  http.get('/api/v1/letters/:id/transitions', ({ params }) => {
    const letter = findLetter(String(params.id));
    const actor = getMockActor();
    if (!letter || !canSeeLetter(letter, actor)) return notFound();
    return HttpResponse.json(letterTransitionsOf(letter, actor));
  }),

  http.post('/api/v1/letters/:id/transitions/:transitionId', async ({ params, request }) => {
    const letter = findLetter(String(params.id));
    const actor = getMockActor();
    if (!letter || !canSeeLetter(letter, actor)) return notFound();
    const raw: unknown = await request.json().catch(() => ({}));
    const parsed = executeTransitionBodySchema.safeParse(raw);
    if (!parsed.success) {
      const issue = registrationIssueOf(parsed.error, ['form', 'registration']);
      return issue
        ? apiError(422, 'LETTER_REGISTRATION_INVALID', issue)
        : apiError(400, 'VALIDATION_FAILED');
    }
    const body = parsed.data;
    const transition = letterTransitionsOf(letter, actor).find((t) => t.id === params.transitionId);
    if (!transition) {
      // Р3: повтор регистрации (второй канцелярист, двойной клик) — 409 с номером.
      if (body.form?.registration && letter.regNumber) {
        return apiError(409, 'LETTER_ALREADY_REGISTERED', { regNumber: letter.regNumber });
      }
      return apiError(409, 'WORKFLOW_TRANSITION_NOT_ALLOWED');
    }
    const missing = missingSections(transition, body);
    if (missing.length > 0) {
      return apiError(422, 'WORKFLOW_TRANSITION_FORM_INVALID', {
        transitionId: transition.id,
        missing,
        unexpected: [],
      });
    }
    const registration = body.form?.registration;
    let attached: ReturnType<typeof attachedRefsOf> | null = null;
    if (registration) {
      const issue = await letterFieldsIssue(registration, request);
      if (issue) return apiError(422, 'LETTER_REGISTRATION_INVALID', issue);
      if (registration.attachedRefs !== undefined) {
        attached = attachedRefsOf(registration.attachedRefs);
        if ('issue' in attached) {
          return apiError(422, 'LETTER_REGISTRATION_INVALID', attached.issue);
        }
      }
      if (registration.replyToLetterId) {
        const relationIssue = letterRelationIssue(letter, registration.replyToLetterId);
        if (relationIssue) return apiError(422, 'LETTER_RELATION_INVALID', relationIssue);
      }
    }
    const fromStageName = letter.stage.name;
    const now = new Date();
    const target = letterDocumentOf(letter.typeId).stages.find(
      (s) => s.id === transition.toStageId,
    )!;
    letter.stage = {
      id: target.id,
      name: target.name,
      order: target.sortOrder,
      systemState: target.systemState,
      color: target.color,
      outcome: target.outcome,
    };
    if (registration) {
      const assigns = letterDocumentOf(letter.typeId)
        .transitions.find((t) => t.id === transition.id)
        ?.rules.postFunctions.some((p) => p.kind === 'assign_number');
      Object.assign(letter, {
        counterparty: counterpartyRefById(registration.counterpartyId) ?? letter.counterparty,
        signer: contactRefOf(registration.counterpartyId, registration.signerId),
        theirNumber: registration.theirNumber,
        theirDate: registration.theirDate,
        subject: registration.subject,
        receiptMethod: receiptMethodRefOf(registration.receiptMethodId),
        project: projectRefOf(registration.projectId),
        addressee: userRef(registration.addresseeId),
        responseDeadline: registration.responseDeadline,
        customFields: registration.customFields
          ? applyDemoPatch('letter', letter.customFields, registration.customFields).next
          : letter.customFields,
        registrar: actorUserRef(),
        // #461: флаг и строки приложенных приходят тем же окном регистрации.
        confidential: registration.confidential ?? letter.confidential,
        attachedRefs: attached && 'refs' in attached ? attached.refs : letter.attachedRefs,
      });
      if (assigns) {
        letter.regNumber = nextLetterNumber(letter.direction, now);
        letter.regDate = localIsoDate(now);
        letter.registeredAt = now.toISOString();
      }
      // Подтверждённая подсказка становится связью «ответ на» (Р5).
      if (registration.replyToLetterId) {
        const target = findLetter(registration.replyToLetterId);
        if (target) {
          letter.replyTo = { id: target.id, regNumber: target.regNumber, subject: target.subject };
          letter.replySuggestion = null;
        }
      }
      pushLetterHistory(letter.id, {
        id: crypto.randomUUID(),
        kind: 'registered',
        at: now.toISOString(),
        actor: actorUserRef(),
        regNumber: letter.regNumber ?? '',
      });
      const conversation = demoConversations.find((c) => c.letter?.id === letter.id);
      if (conversation?.letter) {
        conversation.letter = {
          id: letter.id,
          regNumber: letter.regNumber,
          subject: letter.subject,
        };
      }
    } else {
      const comment = body.form?.comment?.trim();
      pushLetterHistory(letter.id, {
        id: crypto.randomUUID(),
        kind: 'stage_changed',
        at: now.toISOString(),
        actor: actorUserRef(),
        transitionName: transition.name,
        fromStageName,
        toStageName: transition.toStageName,
        ...(comment ? { comment } : {}),
      });
      if (comment) postLetterBlock(letter, transition, fromStageName, comment);
    }
    return HttpResponse.json({
      letter: letterDetailOf(letter, actor),
      transitions: letterTransitionsOf(letter, actor),
    });
  }),
];
