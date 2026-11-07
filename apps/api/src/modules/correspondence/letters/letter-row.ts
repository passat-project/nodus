import type { Prisma } from '../../../generated/prisma/client.js';

/**
 * Выборки строк письма (#55): список — поля реестра, деталь — плюс
 * регистрационные данные и атрибуты. Типы строк выводятся из выборок, чтобы
 * маппер не дублировал поля (как `task-row.ts`).
 */
export const letterListSelect = {
  id: true,
  typeId: true,
  direction: true,
  stageId: true,
  systemState: true,
  regNumber: true,
  regDate: true,
  registeredAt: true,
  receivedAt: true,
  source: true,
  subject: true,
  counterpartyId: true,
  theirNumber: true,
  theirDate: true,
  receiptMethodId: true,
  projectId: true,
  addresseeId: true,
  responseDeadline: true,
  // Конверт почты (#56): строка очереди «Новые» — отправитель и бейдж связи.
  mailFromAddress: true,
  mailFromName: true,
  // «Конфиденциально» (#461, Р4): бейдж-замок в строке реестра.
  confidential: true,
  // Атрибуты строки списка (#632, Р9): колонки видов показывают значения
  // без отдельных запросов; формулы типа считаются на чтении.
  customFields: true,
} as const;

export const letterDetailSelect = {
  ...letterListSelect,
  workflowId: true,
  signerId: true,
  registrarId: true,
  createdBy: true,
  // Полный конверт и флаги приёма (#56) — карточка письма.
  mailMessageId: true,
  mailInReplyTo: true,
  mailReferences: true,
  mailParseIssue: true,
  mailStorageIncomplete: true,
  // PDF-копия тела не создана («Основной документ письма» #56).
  mailBodyPdfIssue: true,
  // Надгробие спама (Р13): невидимо ни в списках, ни в карточке — фильтр.
  deletedAt: true,
} as const;

export type LetterListRow = Prisma.LetterGetPayload<{ select: typeof letterListSelect }>;
export type LetterDetailRow = Prisma.LetterGetPayload<{ select: typeof letterDetailSelect }>;

/** Строка «приложенных писем» (#461, Р3). */
export const letterAttachedRefSelect = {
  id: true,
  number: true,
  counterpartyId: true,
  letterDate: true,
  sortOrder: true,
} as const;

export type LetterAttachedRefRow = Prisma.LetterAttachedRefGetPayload<{
  select: typeof letterAttachedRefSelect;
}>;

export const letterAttachmentSelect = {
  id: true,
  fileId: true,
  role: true,
  sortOrder: true,
  contentId: true,
  inline: true,
} as const;

export type LetterAttachmentRow = Prisma.LetterAttachmentGetPayload<{
  select: typeof letterAttachmentSelect;
}>;

/** Курсор реестра: момент оси и id (tiebreak одного момента). */
export interface LetterCursor {
  at: string;
  id: string;
}
