import type {
  CustomFieldValue,
  LetterAttachedRef,
  LetterAttachedRefInput,
  LetterHistoryChange,
  LetterRegistrationIssue,
  ProjectRef,
  UpdateLetterBody,
} from '@nodus/contracts';
import {
  ErrorCode,
  SystemDictionary,
  checkLetterDates,
  letterRegistrationFieldSchema,
} from '@nodus/contracts';
import { HttpResponse } from 'msw';
import type { z } from 'zod';

import { demoCounterpartyById } from '../../../../shared/mocks/data/counterparties.js';
import {
  applyDemoPatch,
  boundFieldIds,
} from '../../../../shared/mocks/data/custom-fields-rules.js';
import { itemsOf } from '../../../../shared/mocks/data/dictionaries.js';
import {
  localIsoDate,
  findLetter,
  type DemoLetter,
} from '../../../../shared/mocks/data/letters.js';
import { demoProjects } from '../../../../shared/mocks/data/project-views.js';
import { demoUserListItems } from '../../../../shared/mocks/data/users.js';
import { resolveCounterpartyRef } from '../../../../shared/mocks/live-counterparty.js';

/** Общая грамматика проверок мок-сервера писем (#55): регистрация и правка
 *  проверяют одно и то же (Р11 «та же проверка, что при регистрации»). */

export const apiError = (status: number, code: keyof typeof ErrorCode, details?: unknown) =>
  HttpResponse.json({ code: ErrorCode[code], message: code, details }, { status });

export const notFound = () => apiError(404, 'NOT_FOUND');

/** Ввод, который проверяется против справочников (регистрация и правка). */
export interface LetterFieldsCheck {
  /** Тип письма: значения проверяются против его привязок (#631 Р3). */
  typeId: string;
  counterpartyId: string;
  signerId: string | null;
  theirDate?: string | null;
  responseDeadline?: string | null;
  receiptMethodId: string;
  addresseeId?: string;
  customFields?: Record<string, CustomFieldValue | null>;
}

export async function letterFieldsIssue(
  input: LetterFieldsCheck,
  request: Request,
): Promise<LetterRegistrationIssue | null> {
  const card = demoCounterpartyById(input.counterpartyId);
  if (!card && !(await resolveCounterpartyRef(input.counterpartyId, request))) {
    return { field: 'counterpartyId', reason: 'not_found' };
  }
  if (card?.archivedAt) return { field: 'counterpartyId', reason: 'inactive' };
  if (input.signerId && card) {
    const person = card.contactPersons.find((entry) => entry.id === input.signerId);
    if (!person || person.archivedAt) return { field: 'signerId', reason: 'not_of_counterparty' };
  }
  const method = itemsOf(SystemDictionary.RECEIPT_METHOD).find(
    (entry) => entry.id === input.receiptMethodId,
  );
  if (!method) return { field: 'receiptMethodId', reason: 'not_found' };
  if (input.addresseeId !== undefined) {
    const user = demoUserListItems.find((entry) => entry.id === input.addresseeId);
    if (!user) return { field: 'addresseeId', reason: 'not_found' };
    if (user.status !== 'active') return { field: 'addresseeId', reason: 'inactive' };
  }
  const [dateIssue] = checkLetterDates(input, localIsoDate());
  if (dateIssue) return dateIssue;
  if (input.customFields) {
    const { issues } = applyDemoPatch({}, input.customFields, boundFieldIds(input.typeId));
    if (issues.length > 0) return { field: 'customFields', reason: 'invalid' };
  }
  return null;
}

/** Ошибка схемы ввода регистрации → поле и причина 422 (путь после `prefix`). */
export function registrationIssueOf(
  error: z.ZodError,
  prefix: readonly string[],
): LetterRegistrationIssue | null {
  for (const issue of error.issues) {
    if (!prefix.every((part, index) => issue.path[index] === part)) continue;
    const field = letterRegistrationFieldSchema.safeParse(issue.path[prefix.length]);
    if (!field.success) continue;
    const empty = issue.code === 'invalid_type' || issue.code === 'too_small';
    return { field: field.data, reason: empty ? 'required' : 'invalid' };
  }
  return null;
}

/** Подтверждение подсказки «ответ на» (Р5): цель — зарегистрированное
 *  исходящее и ровно свежая подсказка письма (произвольные связи — #461). */
export function letterRelationIssue(
  letter: DemoLetter,
  replyToLetterId: string,
): {
  field: 'replyToLetterId';
  reason: 'not_found' | 'not_outgoing_registered' | 'suggestion_mismatch';
} | null {
  const target = findLetter(replyToLetterId);
  if (!target) return { field: 'replyToLetterId', reason: 'not_found' };
  if (target.direction !== 'outgoing' || target.registeredAt === null) {
    return { field: 'replyToLetterId', reason: 'not_outgoing_registered' };
  }
  if (letter.replyTo !== null || letter.replySuggestion?.id !== replyToLetterId) {
    return { field: 'replyToLetterId', reason: 'suggestion_mismatch' };
  }
  return null;
}

/** Строки «приложенных писем» (#461, Р3): организация обязательна (контрагент
 *  или текст), точный дубль строки — 422 `duplicate`, контрагент — из
 *  справочника. Возвращает готовые строки или поле-причину отказа. */
export function attachedRefsOf(
  inputs: readonly LetterAttachedRefInput[],
): { refs: LetterAttachedRef[] } | { issue: LetterRegistrationIssue } {
  const seen = new Set<string>();
  const refs: LetterAttachedRef[] = [];
  for (const input of inputs) {
    // Организация — только контрагент справочника (вердикт 05.11.2026).
    const counterparty = demoCounterpartyById(input.counterpartyId);
    if (!counterparty) {
      return { issue: { field: 'attachedRefs', reason: 'not_found' } };
    }
    const key = [input.number, input.counterpartyId, input.date ?? ''].join('|').toLowerCase();
    if (seen.has(key)) return { issue: { field: 'attachedRefs', reason: 'duplicate' } };
    seen.add(key);
    refs.push({
      id: crypto.randomUUID(),
      number: input.number,
      counterparty: { id: counterparty.id, name: counterparty.shortName },
      date: input.date,
    });
  }
  return { refs };
}

export function projectRefOf(id: string | null | undefined): ProjectRef | null {
  if (!id) return null;
  const project = demoProjects.find((entry) => entry.id === id);
  return project
    ? { id: project.id, code: project.code, name: project.name, color: project.color }
    : null;
}

export function contactRefOf(counterpartyId: string, contactId: string | null) {
  if (!contactId) return null;
  const person = demoCounterpartyById(counterpartyId)?.contactPersons.find(
    (entry) => entry.id === contactId,
  );
  return person ? { id: person.id, fullName: person.fullName, position: person.position } : null;
}

export function receiptMethodRefOf(id: string) {
  const item = itemsOf(SystemDictionary.RECEIPT_METHOD).find((entry) => entry.id === id);
  return item ? { id: item.id, name: item.name } : null;
}

function cfDisplay(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Изменения правки для журнала (`letter_updated`): значения — строки показа,
 *  ссылки — имена (как гидрирует сервер), даты — ISO. */
export function patchChanges(
  letter: DemoLetter,
  body: UpdateLetterBody,
  next: Pick<DemoLetter, 'counterparty' | 'signer' | 'receiptMethod' | 'project' | 'addressee'>,
): LetterHistoryChange[] {
  const changes: LetterHistoryChange[] = [];
  const push = (field: string, from: string | null, to: string | null) => {
    if (from !== to) changes.push({ field, from, to });
  };
  if (body.counterpartyId !== undefined) {
    push('counterpartyId', letter.counterparty?.name ?? null, next.counterparty?.name ?? null);
  }
  if (body.signerId !== undefined) {
    push('signerId', letter.signer?.fullName ?? null, next.signer?.fullName ?? null);
  }
  if (body.addresseeId !== undefined) {
    push('addresseeId', letter.addressee?.displayName ?? null, next.addressee?.displayName ?? null);
  }
  if (body.theirNumber !== undefined) push('theirNumber', letter.theirNumber, body.theirNumber);
  if (body.theirDate !== undefined) push('theirDate', letter.theirDate, body.theirDate);
  if (body.subject !== undefined) push('subject', letter.subject, body.subject);
  if (body.receiptMethodId !== undefined) {
    push('receiptMethodId', letter.receiptMethod?.name ?? null, next.receiptMethod?.name ?? null);
  }
  if (body.projectId !== undefined) {
    push('projectId', letter.project?.name ?? null, next.project?.name ?? null);
  }
  if (body.responseDeadline !== undefined) {
    push('responseDeadline', letter.responseDeadline, body.responseDeadline);
  }
  if (body.confidential !== undefined) {
    push(
      'confidential',
      letter.confidential ? 'true' : 'false',
      body.confidential ? 'true' : 'false',
    );
  }
  if (body.attachedRefs !== undefined) {
    push('attachedRefs', String(letter.attachedRefs.length), String(body.attachedRefs.length));
  }
  for (const [id, value] of Object.entries(body.customFields ?? {})) {
    push(`cf.${id}`, cfDisplay(letter.customFields[id]), cfDisplay(value));
  }
  return changes;
}
