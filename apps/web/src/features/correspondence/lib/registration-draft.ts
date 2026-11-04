import type {
  ContactRef,
  CounterpartyRef,
  CustomFieldValues,
  DictionaryItem,
  LetterDetail,
  LetterRegistrationField,
  LetterRegistrationInput,
  LetterRegistrationIssue,
  LetterRef,
  LetterRelationReason,
  LetterSource,
  UserRef,
} from '@nodus/contracts';
import { RECEIPT_METHOD_CODES, checkLetterDates, ui } from '@nodus/contracts';

import { todayIso } from './letter-format.js';
import { mainDocumentMissing } from './letter-main-document.js';

/**
 * Черновик формы регистрации (#55, U5) — одна модель для конвейера «Новые»
 * и окна «Зарегистрировать» карточки: ссылки хранятся целиком (имя показывается
 * до ответа сервера), в тело уходят только id (`registrationInputOf`).
 * Обязательность — та же грамматика, что у схемы contracts; даты —
 * `checkLetterDates` (одна функция веба, моков и сервера). Почтовые подсказки
 * #56: `suggestedReply` — «ответ на» по теме, `linkReply` — галочка Вики.
 */
export interface RegistrationDraft {
  counterparty: CounterpartyRef | null;
  signer: ContactRef | null;
  theirNumber: string;
  /** ISO-дата; null — не введена или не разобрана. */
  theirDate: string | null;
  subject: string;
  receiptMethodId: string | null;
  projectId: string | null;
  addressee: UserRef | null;
  responseDeadline: string | null;
  customFields: CustomFieldValues;
  /** Подсказка «ответ на» (Р5); подтверждение — `linkReply`. */
  suggestedReply: LetterRef | null;
  linkReply: boolean;
  /** «Конфиденциально» (#461, Р4): письмо, чат, файлы и поручения — участникам. */
  confidential: boolean;
  /** Строки «приложенных писем» конверта-матрёшки (#461, Р3). */
  attachedRefs: AttachedRefDraft[];
}

/** Строка «приложенных писем» в черновике: организация — контрагент
 *  справочника (единственный источник, вердикт 05.11.2026); ссылка хранится
 *  целиком (имя видно до ответа сервера), в тело уходит `counterpartyId`. */
export interface AttachedRefDraft {
  number: string;
  counterparty: CounterpartyRef | null;
  date: string | null;
}

/** Обязательные поля в порядке формы — и порядок «Enter → следующее пустое». */
export const REQUIRED_FIELDS: readonly LetterRegistrationField[] = [
  'counterpartyId',
  'theirNumber',
  'theirDate',
  'subject',
  'receiptMethodId',
  'addresseeId',
];

export const registrationFieldLabel: Record<LetterRegistrationField, string> = {
  counterpartyId: ui.letters.fields.counterparty,
  signerId: ui.letters.fields.signer,
  theirNumber: ui.letters.fields.theirNumber,
  theirDate: ui.letters.fields.theirDate,
  subject: ui.letters.fields.subject,
  receiptMethodId: ui.letters.fields.receiptMethod,
  projectId: ui.letters.fields.project,
  addresseeId: ui.letters.fields.addressee,
  responseDeadline: ui.letters.fields.responseDeadline,
  replyToLetterId: ui.letters.pipeline.replyBadge,
  confidential: ui.letters.fields.confidential,
  attachedRefs: ui.letters.fields.attachedRefs,
  customFields: ui.letters.form.attributes,
  mainDocument: ui.letters.fields.mainDocument,
};

export const registrationReasonText: Record<LetterRegistrationIssue['reason'], string> = {
  required: ui.letters.form.required,
  invalid: ui.letters.form.invalid,
  in_future: ui.letters.form.inFuture,
  in_past: ui.letters.form.inPast,
  not_found: ui.letters.form.notFound,
  inactive: ui.letters.form.inactive,
  not_of_counterparty: ui.letters.form.notOfCounterparty,
  duplicate: ui.letters.attached.duplicate,
};

/** Причины 422 связи «ответ на» (#56, Р5). */
export const relationReasonText: Record<LetterRelationReason, string> = {
  not_found: ui.letters.form.replyInvalid.not_found,
  not_outgoing_registered: ui.letters.form.replyInvalid.not_outgoing_registered,
  not_registered: ui.letters.relations.invalid.not_registered,
  suggestion_mismatch: ui.letters.form.replyInvalid.suggestion_mismatch,
  already_linked: ui.letters.relations.invalid.already_linked,
  cycle: ui.letters.relations.invalid.cycle,
};

/** Текст ошибки сервера по полю+причине (регистрация и связь «ответ на»). */
export function registrationErrorText(field: string, reason: string): string | null {
  if (field === 'replyToLetterId' && reason in relationReasonText) {
    return relationReasonText[reason as LetterRelationReason];
  }
  return reason in registrationReasonText
    ? registrationReasonText[reason as LetterRegistrationIssue['reason']]
    : null;
}

/** Умолчание способа поступления (Р14): бумага — «Почта», почта — «Электронная почта». */
export function defaultReceiptMethodId(
  source: LetterSource,
  methods: readonly DictionaryItem[],
): string | null {
  const code = source === 'manual' ? RECEIPT_METHOD_CODES.post : RECEIPT_METHOD_CODES.email;
  return methods.find((method) => method.code === code && method.isActive)?.id ?? null;
}

export function initialDraft(
  letter: LetterDetail,
  methods: readonly DictionaryItem[],
): RegistrationDraft {
  return {
    counterparty: letter.counterparty,
    signer: letter.signer,
    theirNumber: letter.theirNumber ?? '',
    theirDate: letter.theirDate,
    subject: letter.subject ?? '',
    receiptMethodId: letter.receiptMethod?.id ?? defaultReceiptMethodId(letter.source, methods),
    projectId: letter.project?.id ?? null,
    addressee: letter.addressee,
    responseDeadline: letter.responseDeadline,
    customFields: { ...letter.customFields },
    suggestedReply: letter.replySuggestion,
    linkReply: false,
    confidential: letter.confidential,
    attachedRefs: letter.attachedRefs.map((ref) => ({
      number: ref.number,
      counterparty: ref.counterparty,
      date: ref.date,
    })),
  };
}

function filled(draft: RegistrationDraft, field: LetterRegistrationField): boolean {
  switch (field) {
    case 'counterpartyId':
      return draft.counterparty !== null;
    case 'theirNumber':
      return draft.theirNumber.trim().length > 0;
    case 'theirDate':
      return draft.theirDate !== null;
    case 'subject':
      return draft.subject.trim().length > 0;
    case 'receiptMethodId':
      return draft.receiptMethodId !== null;
    case 'addresseeId':
      return draft.addressee !== null;
    default:
      return true;
  }
}

/** Незаполненные обязательные поля («Не хватает: …»). */
export function missingFields(draft: RegistrationDraft): LetterRegistrationField[] {
  return REQUIRED_FIELDS.filter((field) => !filled(draft, field));
}

/** Следующее пустое обязательное поле после `after` (Enter в форме). */
export function nextEmptyField(
  draft: RegistrationDraft,
  after: LetterRegistrationField,
): LetterRegistrationField | null {
  const start = REQUIRED_FIELDS.indexOf(after);
  return REQUIRED_FIELDS.slice(start + 1).find((field) => !filled(draft, field)) ?? null;
}

/** Ошибки полей до отправки: даты против «сегодня» (те же, что у сервера). */
export function draftIssues(draft: RegistrationDraft, today: string): LetterRegistrationIssue[] {
  return checkLetterDates(draft, today);
}

/** Тело раздела «Регистрация» или null, пока форма не готова. */
export function registrationInputOf(
  draft: RegistrationDraft,
  today: string,
): LetterRegistrationInput | null {
  if (missingFields(draft).length > 0 || draftIssues(draft, today).length > 0) return null;
  const customFields = Object.fromEntries(
    Object.entries(draft.customFields).filter(([, value]) => value !== null && value !== undefined),
  );
  return {
    counterpartyId: draft.counterparty!.id,
    signerId: draft.signer?.id ?? null,
    theirNumber: draft.theirNumber.trim(),
    theirDate: draft.theirDate!,
    subject: draft.subject.trim(),
    receiptMethodId: draft.receiptMethodId!,
    projectId: draft.projectId,
    addresseeId: draft.addressee!.id,
    responseDeadline: draft.responseDeadline,
    confidential: draft.confidential,
    ...(draft.attachedRefs.length > 0
      ? {
          // Строки без контрагента в тело не уходят: схема требует
          // контрагента (вердикт 05.11.2026), а недозаполненная строка
          // отсекается ещё в окне строки.
          attachedRefs: draft.attachedRefs.flatMap((ref) =>
            ref.counterparty
              ? [
                  {
                    number: ref.number.trim(),
                    counterpartyId: ref.counterparty.id,
                    date: ref.date,
                  },
                ]
              : [],
          ),
        }
      : {}),
    ...(draft.linkReply && draft.suggestedReply
      ? { replyToLetterId: draft.suggestedReply.id }
      : {}),
    ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
  };
}

/** Ввод регистрации из САМОГО ПИСЬМА (редизайн #56): карточка-форма правит
 *  поля по месту, и когда обязательные заполнены — «Зарегистрировать» в
 *  баре идёт напрямую, без окна (окно — контроль пропусков). null — что-то
 *  из обязательного пусто или дата не по правилам, нужен контроль окна. */
export function letterRegistrationInput(
  letter: LetterDetail,
  methods: readonly DictionaryItem[],
): LetterRegistrationInput | null {
  // «Основной документ письма» (#56): кандидаты без выбора звезды — окно
  // (контроль пропусков), прямая регистрация не идёт.
  if (mainDocumentMissing(letter)) return null;
  return registrationInputOf(initialDraft(letter, methods), todayIso());
}
