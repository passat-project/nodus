import { asRecord, clip, date, nameOf, num, str } from '../projections.js';
import type { ToolActionField, ToolContext } from '../tool-definition.js';

/**
 * Общие куски карточек подтверждения (Ф2, ADR-0048): имена вместо id,
 * человеческие даты, поля-столбиком. Всё терпимо к недоступному имени —
 * карточка обязана собраться даже без дочитывания (тогда id как есть).
 */

/** Имя сущности по адресу API; недоступно — null (покажем id). */
export async function readName(ctx: ToolContext, path: string): Promise<string | null> {
  if (!ctx.read) return null;
  try {
    return nameOf(await ctx.read(path));
  } catch {
    return null;
  }
}

export function userName(ctx: ToolContext, id: string): Promise<string | null> {
  return readName(ctx, `/directory/users/${id}`);
}

export function projectName(ctx: ToolContext, id: string): Promise<string | null> {
  return readName(ctx, `/projects/${id}`);
}

export function conversationTitle(ctx: ToolContext, id: string): Promise<string | null> {
  return readName(ctx, `/chat/conversations/${id}`);
}

/** Задача карточкой: «№1042 «Проверить смету»» (номер + название). */
export async function taskLabel(ctx: ToolContext, id: string): Promise<string | null> {
  if (!ctx.read) return null;
  try {
    const task = asRecord(await ctx.read(`/tasks/${id}`));
    const title = str(task?.title);
    if (!title) return null;
    const number = num(task?.number);
    return number ? `№${number} «${title}»` : `«${title}»`;
  } catch {
    return null;
  }
}

/** Письмо карточкой: «№Вх-2026/118 «Тема»» (без номера — только тема). */
export async function letterLabel(ctx: ToolContext, id: string): Promise<string | null> {
  if (!ctx.read) return null;
  try {
    const letter = asRecord(await ctx.read(`/letters/${id}`));
    const subject = str(letter?.subject);
    if (!subject) return null;
    const number = str(letter?.regNumber);
    return `${number ? `№${number} ` : ''}«${subject}»`;
  } catch {
    return null;
  }
}

/** Проект карточкой: «шифр «Имя»», без шифра — «Имя». */
export async function projectLabel(ctx: ToolContext, id: string): Promise<string | null> {
  if (!ctx.read) return null;
  try {
    const project = asRecord(await ctx.read(`/projects/${id}`));
    const name = str(project?.name);
    if (!name) return null;
    const code = str(project?.code);
    return code ? `${code} «${name}»` : `«${name}»`;
  } catch {
    return null;
  }
}

/** Контрагент карточкой: краткое имя, иначе полное. */
export async function counterpartyName(ctx: ToolContext, id: string): Promise<string | null> {
  if (!ctx.read) return null;
  try {
    const counterparty = asRecord(await ctx.read(`/counterparties/${id}`));
    return str(counterparty?.shortName) ?? str(counterparty?.fullName);
  } catch {
    return null;
  }
}

/** Поле карточки: пустое значение не показываем вовсе. */
export function field(label: string, value: string | null | undefined): ToolActionField | null {
  const trimmed = value?.trim();
  return trimmed ? { label, value: trimmed } : null;
}

export function fieldsOf(entries: readonly (ToolActionField | null)[]): ToolActionField[] {
  return entries.filter((entry): entry is ToolActionField => entry !== null);
}

/** Срок человеческим текстом: «14 ноя 2026, 18:00» по UTC-дате портала. */
export function humanDate(iso: string | null | undefined): string | null {
  return date(iso);
}

/** Короткий id для карточки, когда имя дочитать не удалось. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Значения формы действия: «поле: значение» — сотрудник видит, что уйдёт. */
export function formValues(form: unknown): string | null {
  const record = asRecord(form);
  if (!record) return null;
  const fields = asRecord(record.fields) ?? record;
  const entries = Object.entries(fields).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );
  if (entries.length === 0) return null;
  const shown = entries
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  if (entries.length > 6) shown.push(`… и ещё ${entries.length - 6}`);
  return clip(shown.join('; '), 400);
}
