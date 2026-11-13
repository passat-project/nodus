/**
 * Логика @упоминаний композера (#176): детектор запроса у каретки, слияние
 * кандидатов (участники первыми, затем серверный поиск справочника),
 * вставка/правка/удаление токена `@[текст](user:id)`. Всё чистыми
 * функциями — unit-тесты без React; клавиатура и данные — в хуке панели.
 */

import type { UserListItem, UserRef } from '@nodus/contracts';
import { MENTION_ALL_ID, ui } from '@nodus/contracts';

/** Кандидат автокомплита: участник беседы, сотрудник справочника или
 *  спец-кандидат «Все» (#224). */
export interface MentionCandidate {
  id: string;
  displayName: string;
  positionName: string | null;
  departmentName: string | null;
  avatarUrl: string | null;
  /** Участник этой беседы — пингуется; прочие — с пометкой «не в беседе». */
  inConversation: boolean;
  /** «Все» (#224): пинг всем участникам, иконка вместо аватара. */
  isAll?: boolean;
}

/** Активный запрос автокомплита: `@` на границе слова + набранные буквы
 *  до каретки. null — автокомплит закрыт. */
export interface MentionQuery {
  /** Введённый после @ текст (может быть пустым — панель показывает участников). */
  query: string;
  /** Смещение '@' в тексте. */
  start: number;
  /** Конец запроса = позиция каретки. */
  end: number;
}

const QUERY_MAX = 32;

/** @запрос у каретки: '@' стоит в начале строки/после пробела или знака
 *  (email `a@b.by` панелью не становится), запрос — буквы/цифры/точки/
 *  дефисы без пробелов до каретки. */
export function detectMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  const query = before.slice(at + 1);
  if (query.length > QUERY_MAX) return null;
  if (/[\s(]/.test(query)) return null; // пробел/скобка закрыли запрос
  const prev = at > 0 ? text[at - 1] : '';
  if (prev && /[\p{L}\p{M}\p{N}@]/u.test(prev)) return null; // середина слова/email
  return { query, start: at, end: caret };
}

/** Слияние кандидатов: «Все» закреплено первой строкой (показ при пустом
 *  запросе или вводе «все»), затем участники беседы (по подстроке query,
 *  без регистра), затем сотрудники поиска справочника, не-участники — с
 *  пометкой; дедуп по id, лимит списка. Справочник обогащает участников
 *  должностью/отделом (общий кэш usersList). Себя не предлагаем: сервер
 *  пингует только ≠ автора (упомянуть себя нельзя, канон Slack). */
export function mergeMentionCandidates(
  members: UserRef[],
  directory: UserListItem[],
  query: string,
  meId: string | undefined,
): MentionCandidate[] {
  const byId = new Map<string, MentionCandidate>();
  const lower = query.toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(lower);

  // «Все» (#224): первая строка панели — канал Slack @channel.
  const allLabel = ui.chat.mentionAllLabel.toLowerCase();
  if (lower.length === 0 || allLabel.startsWith(lower)) {
    byId.set(MENTION_ALL_ID, {
      id: MENTION_ALL_ID,
      displayName: ui.chat.mentionAllLabel,
      positionName: ui.chat.mentionAllNote,
      departmentName: null,
      avatarUrl: null,
      inConversation: true,
      isAll: true,
    });
  }

  for (const member of members) {
    if (member.id === meId) continue;
    if (!matches(member.displayName)) continue;
    byId.set(member.id, {
      id: member.id,
      displayName: member.displayName,
      positionName: null,
      departmentName: null,
      avatarUrl: member.avatarUrl,
      inConversation: true,
    });
  }
  for (const person of directory) {
    const existing = byId.get(person.id);
    if (existing) {
      existing.positionName = person.positionName;
      existing.departmentName = person.departmentName;
      continue;
    }
    if (byId.size >= MENTION_CANDIDATES_MAX) continue;
    if (person.id === meId) continue;
    if (!matches(person.displayName) && !matches(person.email)) continue;
    byId.set(person.id, {
      id: person.id,
      displayName: person.displayName,
      positionName: person.positionName,
      departmentName: person.departmentName,
      avatarUrl: person.avatarUrl,
      inConversation: false,
    });
  }
  return [...byId.values()].slice(0, MENTION_CANDIDATES_MAX);
}

/** Кандидатов в панели автокомплита — до 20 (как лимит запроса справочника),
 *  видно 9 рядов (360px), дальше прокрутка (мировая практика комбобоксов:
 *  8–10 видимых рядов, 20 кандидатов — Expensify; #844). Больше не надо:
 *  фильтрация вводом эффективнее «прокрутки вселенной». */
export const MENTION_CANDIDATES_MAX = 20;
