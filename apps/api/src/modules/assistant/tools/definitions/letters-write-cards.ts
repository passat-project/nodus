import { letterResultText } from './letters-parts.tools.js';
import { shortId, userName } from './write-cards.js';

/**
 * Общие куски проекции и карточки письма для write-инструментов (#930):
 * ответ API приходит письмом напрямую или в обёртке `{ letter }`, а ссылка на
 * карточку собирается из номера и темы.
 */

export function successText(data: unknown, fallback: string): string {
  const letter = letterResultText(data);
  if (!letter.id) return fallback;
  return `${fallback}: ${letter.number ? `№${letter.number} ` : ''}«${letter.subject ?? '—'}»`;
}

export function letterEntity(data: unknown): { href: string; label: string } | undefined {
  const letter = letterResultText(data);
  if (!letter.id) return undefined;
  return {
    href: `?cards=letter:${letter.id}`,
    label: `${letter.number ? `№${letter.number} ` : ''}${letter.subject ?? 'Письмо'}`.trim(),
  };
}

/** Имена коллег через запятую; недоступное имя — короткий id. */
export async function names(
  ctx: import('../tool-definition.js').ToolContext,
  ids: readonly string[],
): Promise<string | null> {
  if (ids.length === 0) return null;
  const resolved = await Promise.all(ids.map((id) => userName(ctx, id)));
  return resolved.map((name, index) => name ?? shortId(ids[index]!)).join(', ') || null;
}
