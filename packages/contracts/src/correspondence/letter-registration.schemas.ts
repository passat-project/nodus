import { z } from 'zod';

import { customFieldValuesInputSchema } from '../custom-fields/custom-field-values.js';

/**
 * Регистрация входящего письма (#55, ADR-0027): раздел окна перехода
 * `registration` кнопки «Зарегистрировать» (Р1). Файл НЕ импортирует
 * `workflows/*` и `tasks/*`: его подключает `transition-form.schemas.ts`
 * (тело перехода), иначе цикл `workflow.schemas → … → workflow.schemas`.
 * Одна грамматика веба (форма конвейера и окна), моков и сервера
 * (исключение «общая грамматика» patterns.md): обязательность — схема,
 * даты — `checkLetterDates`.
 */

/** Лимиты писем — контракт: подсказки форм и проверки сервера. */
export const LETTER_LIMITS = {
  /** № документа корреспондента. */
  theirNumber: 64,
  /** Тема письма. */
  subject: 500,
  /** Файлов при ручном создании (скан + приложения). */
  files: 20,
  /** Вложений письма почты (#56, Р12): сверх — не сохраняются, письмо
   *  помечается `storageIncomplete`. */
  mailFiles: 50,
  /** Идентификаторов References цепочки в построении «ответ на» (Р5):
   *  парсер отдаёт список целиком, кап берёт threading (свежие ID). */
  mailReferences: 100,
  /** Байт одного файла ручного создания (лимит вложений портала). */
  fileBytes: 100 * 1024 * 1024,
  /** Поиск по спискам писем. */
  search: 128,
  /** Адресатов «Принимают решения» в выдаче `/letters/resolvers`. */
  resolvers: 100,
  /** Изменений в одной записи истории (`letter_updated`). */
  changes: 20,
  /** Строк «приложенных писем» в одном письме (#461, Р3): конверт-матрёшка
   *  — до десятков листов, 20 строк с запасом. */
  attachedRefs: 20,
  /** № приложенного письма (#461) — зеркало theirNumber: ключ поиска. */
  attachedNumber: 64,
  /** Организация приложенного письма текстом, когда нет контрагента (#461). */
  attachedOrg: 160,
} as const;

/** Строка «приложенных писем» на вводе (#461, Р3): № + организация
 *  (контрагент справочника ИЛИ текст на бумаге) + дата листа. Пустая
 *  организация допустима схемой — сервер отказывает 422 с полем
 *  `attachedRefs` (одна грамматика отказа для веба, моков и сервера). */
export const letterAttachedRefInputSchema = z
  .object({
    number: z.string().trim().min(1).max(LETTER_LIMITS.attachedNumber),
    counterpartyId: z.uuid().nullable(),
    orgText: z.string().trim().min(1).max(LETTER_LIMITS.attachedOrg).nullable(),
    date: z.iso.date().nullable(),
  })
  .strict();
export type LetterAttachedRefInput = z.infer<typeof letterAttachedRefInputSchema>;

/** Ввод регистрации (`form.registration` тела перехода, Р1): адресат
 *  обязателен (В1), подписант — контакт корреспондента или пусто.
 *  `replyToLetterId` — подтверждение подсказки «ответ на» галочкой (#56,
 *  Р5): ровно свежая подсказка сервера, произвольные связи — #461.
 *  `confidential` — флаг «Конфиденциально» (#461, Р4): письмо, чат, файлы и
 *  поручения видят только участники; `attachedRefs` — строки «приложенных
 *  писем» конверта-матрёшки (#461, Р3). */
export const letterRegistrationInputSchema = z
  .object({
    counterpartyId: z.uuid(),
    signerId: z.uuid().nullable(),
    theirNumber: z.string().trim().min(1).max(LETTER_LIMITS.theirNumber),
    theirDate: z.iso.date(),
    subject: z.string().trim().min(1).max(LETTER_LIMITS.subject),
    receiptMethodId: z.uuid(),
    projectId: z.uuid().nullable(),
    addresseeId: z.uuid(),
    responseDeadline: z.iso.date().nullable(),
    replyToLetterId: z.uuid().nullable().optional(),
    confidential: z.boolean().optional(),
    attachedRefs: z.array(letterAttachedRefInputSchema).max(LETTER_LIMITS.attachedRefs).optional(),
    customFields: customFieldValuesInputSchema.optional(),
  })
  .strict();
export type LetterRegistrationInput = z.infer<typeof letterRegistrationInputSchema>;

/** Поле формы регистрации (ключ подсветки и `details.field` ответа 422).
 *  `mainDocument` — не поле ввода, а пропуск «основной документ»
 *  («Основной документ письма» #56): сервер отказывает 422 с этим ключом,
 *  когда у письма есть файлы-кандидаты, а ни один не выбран звёздочкой;
 *  выбор — отдельным `POST /letters/:id/main-document`, в теле регистрации
 *  не передаётся. */
export const letterRegistrationFieldSchema = z.enum([
  'counterpartyId',
  'signerId',
  'theirNumber',
  'theirDate',
  'subject',
  'receiptMethodId',
  'projectId',
  'addresseeId',
  'responseDeadline',
  'replyToLetterId',
  'confidential',
  'attachedRefs',
  'customFields',
  'mainDocument',
]);
export type LetterRegistrationField = z.infer<typeof letterRegistrationFieldSchema>;

/** Причина отказа `422 LETTER_RELATION_INVALID` (связи «ответ на» /
 *  «вложено в», #56/#461): цель не найдена/не видна, не зарегистрирована,
 *  не исходящее зарегистрированное (галочка регистрации), не совпадает со
 *  свежей подсказкой, связь уже есть (нужен `replace`), цель — в цепочке
 *  самого письма (цикл). */
export const letterRelationReasonSchema = z.enum([
  'not_found',
  'not_outgoing_registered',
  'not_registered',
  'suggestion_mismatch',
  'already_linked',
  'cycle',
]);
export type LetterRelationReason = z.infer<typeof letterRelationReasonSchema>;

/** Причина отказа поля (`422 LETTER_REGISTRATION_INVALID`, `details {field,
 *  reason}`): пусто, неверный формат, дата в будущем/прошлом, ссылка не
 *  найдена/неактивна (уволенный адресат, архивный контрагент), подписант не
 *  из контактов корреспондента, точный дубль строки приложенных писем
 *  (#461, Р3). */
export const letterRegistrationReasonSchema = z.enum([
  'required',
  'invalid',
  'in_future',
  'in_past',
  'not_found',
  'inactive',
  'not_of_counterparty',
  'duplicate',
]);
export type LetterRegistrationReason = z.infer<typeof letterRegistrationReasonSchema>;

export const letterRegistrationIssueSchema = z.object({
  field: letterRegistrationFieldSchema,
  reason: letterRegistrationReasonSchema,
});
export type LetterRegistrationIssue = z.infer<typeof letterRegistrationIssueSchema>;

/**
 * Даты регистрации против «сегодня» компании (ISO-дата `YYYY-MM-DD`, часовой
 * пояс компании — сервер, веб берёт локальную дату): дата документа
 * корреспондента — не позже сегодня, срок ответа — не раньше сегодня.
 * ISO-даты сравниваются строками. Пустые значения не проверяются —
 * обязательность решает схема.
 */
export function checkLetterDates(
  input: { theirDate?: string | null; responseDeadline?: string | null },
  today: string,
): LetterRegistrationIssue[] {
  const issues: LetterRegistrationIssue[] = [];
  if (input.theirDate && input.theirDate > today) {
    issues.push({ field: 'theirDate', reason: 'in_future' });
  }
  if (input.responseDeadline && input.responseDeadline < today) {
    issues.push({ field: 'responseDeadline', reason: 'in_past' });
  }
  return issues;
}
