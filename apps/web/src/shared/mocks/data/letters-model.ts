import type {
  ContactRef,
  CounterpartyRef,
  CustomFieldValues,
  LetterAccess,
  LetterAttachment,
  LetterBody,
  LetterBox,
  LetterCounterpartySuggestion,
  LetterDetail,
  LetterDirection,
  LetterListItem,
  LetterMailInfo,
  LetterRef,
  LetterSource,
  ProjectRef,
  ReceiptMethodRef,
  TaskStage,
  UserRef,
} from '@nodus/contracts';
import { isFinalState, Permission } from '@nodus/contracts';

import { demoCounterparties } from './counterparties.js';
import { letterProcessTypes } from './letter-catalog.js';

/** Запись письма мок-сервера (#55): поля `LetterDetail` без вычисляемых
 *  (тип-ссылка, счётчик файлов, права зрителя) + участники обсуждения и
 *  автор (ручное создание). Чистые функции — без состояния и актёра. */
export interface DemoLetter {
  id: string;
  typeId: string;
  direction: LetterDirection;
  stage: TaskStage;
  regNumber: string | null;
  regDate: string | null;
  registeredAt: string | null;
  receivedAt: string;
  source: LetterSource;
  subject: string | null;
  counterparty: CounterpartyRef | null;
  theirNumber: string | null;
  theirDate: string | null;
  receiptMethod: ReceiptMethodRef | null;
  project: ProjectRef | null;
  addressee: UserRef | null;
  responseDeadline: string | null;
  signer: ContactRef | null;
  registrar: UserRef | null;
  /** Конверт почты (#56); null — внесено вручную. */
  mail: LetterMailInfo | null;
  /** Авто-связь «ответ на» по цепочке (Р5); подтверждённая галочкой — сюда же. */
  replyTo: LetterRef | null;
  /** Нечёткая подсказка по теме (Р5); показывается, пока replyTo нет. */
  replySuggestion: LetterRef | null;
  attachments: LetterAttachment[];
  body: LetterBody;
  customFields: CustomFieldValues;
  /** Присоединившиеся к обсуждению (адресат — участник по роли). */
  participantIds: string[];
  createdById: string | null;
}

/** Актёр мок-сервера: id и права (без импорта стора сессии). */
export interface LetterActor {
  id: string;
  permissions: readonly string[];
}

export function canRegisterLetters(actor: LetterActor): boolean {
  return actor.permissions.includes(Permission.CORRESPONDENCE_REGISTER);
}

/** Видимость (Р7): зарегистрированное — всем, незарегистрированное —
 *  держателям `correspondence.register`; невидимое — 404 без оракула. */
export function canSeeLetter(letter: DemoLetter, actor: LetterActor): boolean {
  return letter.registeredAt !== null || canRegisterLetters(actor);
}

/** Вкладка письма: «Новые» — незарегистрированные в начальной стадии;
 *  закрытые без регистрации не попадают никуда (видны по ссылке). */
export function boxOf(letter: DemoLetter): LetterBox | null {
  if (letter.registeredAt !== null) return letter.direction;
  return letter.stage.systemState === 'backlog' ? 'new' : null;
}

/** Участники обсуждения письма: адресат + присоединившиеся (регистратор — нет, В2). */
export function letterMemberIds(letter: DemoLetter): string[] {
  const ids = letter.addressee ? [letter.addressee.id] : [];
  for (const id of letter.participantIds) if (!ids.includes(id)) ids.push(id);
  return ids;
}

export function letterRefOf(letter: DemoLetter): LetterRef {
  return { id: letter.id, regNumber: letter.regNumber, subject: letter.subject };
}

export function letterListItemOf(
  letter: DemoLetter,
  viewed = letter.registeredAt !== null,
): LetterListItem {
  return {
    id: letter.id,
    typeId: letter.typeId,
    direction: letter.direction,
    stage: letter.stage,
    regNumber: letter.regNumber,
    regDate: letter.regDate,
    registeredAt: letter.registeredAt,
    receivedAt: letter.receivedAt,
    source: letter.source,
    mailFromName: letter.mail?.fromName ?? null,
    mailFromAddress: letter.mail?.fromAddress ?? null,
    subject: letter.subject,
    counterparty: letter.counterparty,
    theirNumber: letter.theirNumber,
    theirDate: letter.theirDate,
    receiptMethod: letter.receiptMethod,
    project: letter.project,
    addressee: letter.addressee,
    responseDeadline: letter.responseDeadline,
    replyTo: letter.replyTo,
    attachmentCount: letter.attachments.filter((a) => a.role !== 'source' && !a.inline).length,
    viewed,
  };
}

/** Подстановка по адресу отправителя (Р6): ровно один активный контакт
 *  справочника с таким адресом — как серверный COUNTERPARTY_READER. */
export function counterpartySuggestionOf(letter: DemoLetter): LetterCounterpartySuggestion | null {
  if (!letter.mail) return null;
  const email = letter.mail.fromAddress.trim().toLowerCase();
  const matches = demoCounterparties
    .filter((card) => !card.archivedAt)
    .flatMap((card) =>
      card.contactPersons
        .filter((person) => !person.archivedAt && person.email?.trim().toLowerCase() === email)
        .map((person) => ({ counterpartyId: card.id, signerId: person.id })),
    );
  return matches.length === 1 ? matches[0]! : null;
}

function accessOf(letter: DemoLetter, actor: LetterActor): LetterAccess {
  // Зеркало серверного letter-access (редизайн #56): правка реквизитов —
  // канцелярия (и незарегистрированного — форма по месту в карточке),
  // «Присоединиться» — канцелярия может начать обсуждение до регистрации.
  const register = canRegisterLetters(actor);
  const registered = letter.registeredAt !== null;
  const isParticipant = letterMemberIds(letter).includes(actor.id);
  return {
    canEdit: register,
    canDeleteSpam: !registered && !isFinalState(letter.stage.systemState) && register,
    canJoin: !isParticipant && (registered || register),
    isParticipant,
  };
}

export function letterDetailOf(letter: DemoLetter, actor: LetterActor): LetterDetail {
  const type = letterProcessTypes.find((t) => t.id === letter.typeId) ?? letterProcessTypes[0]!;
  return {
    ...letterListItemOf(letter, true),
    type: {
      id: type.id,
      code: type.code,
      name: type.name,
      category: type.category,
      icon: type.icon,
      color: type.color,
    },
    signer: letter.signer,
    registrar: letter.registrar,
    mail: letter.mail,
    // Подсказка живёт, пока связь не поставлена (авто или галочкой).
    replySuggestion: letter.replyTo ? null : letter.replySuggestion,
    counterpartySuggestion: counterpartySuggestionOf(letter),
    attachments: letter.attachments,
    body: letter.body,
    customFields: letter.customFields,
    customFieldRefs: [],
    access: accessOf(letter, actor),
  };
}
