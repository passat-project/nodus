import type {
  LetterDirection,
  LetterHistoryEntry,
  LetterRelationKind,
  LetterTreeNode,
  LetterTreeResponse,
} from '@nodus/contracts';

import { seedHistory } from './letter-history-seed.js';
import { seedLetters } from './letter-seed.js';
import { canSeeLetter, type DemoLetter, type LetterActor } from './letters-model.js';

export { lid } from './letter-ids.js';
export * from './letters-model.js';

/** Состояние мок-сервера писем (#55): письма, журнал и счётчики серий —
 *  в памяти страницы (перезагрузка возвращает демо-мир, gotcha msw-query).
 *  Общий стор доменов letters, chat (беседа письма), crm (счётчик писем). */

export const demoLetters: DemoLetter[] = seedLetters();

export const letterHistory: Map<string, LetterHistoryEntry[]> = seedHistory(demoLetters);

/** «Я открывал» (редизайн #56): личный признак мока — какие незарегистриро-
 * ванные письма текущий актёр открывал карточкой (сброс — F5). */
export const viewedLetterIds: Set<string> = new Set();

export function findLetter(id: string): DemoLetter | undefined {
  return demoLetters.find((letter) => letter.id === id);
}

/** Запись журнала письма — новые сверху (как `GET /letters/:id/history`). */
export function pushLetterHistory(letterId: string, entry: LetterHistoryEntry): void {
  const entries = letterHistory.get(letterId) ?? [];
  entries.unshift(entry);
  letterHistory.set(letterId, entries);
}

/** Серии номеров без пропусков и со сбросом по году (Р2): демо-набор
 *  заканчивается Вх-2026/117 — первая регистрация даёт «Вх-2026/118»;
 *  исходящее Исх-2026/1 уже отправлено (демо #56). */
const series: Record<LetterDirection, { prefix: string; year: number; last: number }> = {
  incoming: { prefix: 'Вх', year: 2026, last: 117 },
  outgoing: { prefix: 'Исх', year: 2026, last: 1 },
};

export function nextLetterNumber(direction: LetterDirection, at = new Date()): string {
  const entry = series[direction];
  const year = at.getFullYear();
  if (year !== entry.year) {
    entry.year = year;
    entry.last = 0;
  }
  entry.last += 1;
  return `${entry.prefix}-${year}/${entry.last}`;
}

/** Локальная ISO-дата (часовой пояс компании в моке — браузер). */
export function localIsoDate(at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Зарегистрированных писем контрагента — счётчик карточки CRM (проекция):
 *  то же правило видимости, что у списка (#461, Р4) — конфиденциальные вне
 *  круга зрителя не считаются. */
export function lettersCountOf(counterpartyId: string, actor: LetterActor): number {
  return demoLetters.filter(
    (letter) =>
      letter.registeredAt !== null &&
      letter.counterparty?.id === counterpartyId &&
      canSeeLetter(letter, actor),
  ).length;
}

// ===== Связи и «ёлочка» (#461, Р1/Р2) =====

/** Id связи мока: детерминирован по письму и виду (сервер — uuid строки). */
const relationIds = new Map<string, string>();
export function relationIdOf(letterId: string, kind: LetterRelationKind): string {
  const key = `${letterId}:${kind}`;
  let id = relationIds.get(key);
  if (!id) {
    id = crypto.randomUUID();
    relationIds.set(key, id);
  }
  return id;
}

/** Родитель письма в дереве: конверт-матрёшка приоритетнее ответа
 *  (физическая вложенность), затем «ответ на». */
export function letterParentOf(letter: DemoLetter): {
  kind: LetterRelationKind;
  ref: NonNullable<DemoLetter['replyTo']>;
} | null {
  if (letter.nestedIn) return { kind: 'nested_in', ref: letter.nestedIn };
  if (letter.replyTo) return { kind: 'reply_to', ref: letter.replyTo };
  return null;
}

/** Дети письма: вложенные письма конверта и ответы на него (видимые зрителю). */
export function letterChildrenOf(
  letterId: string,
  actor: LetterActor,
  letters: readonly DemoLetter[] = demoLetters,
): { letter: DemoLetter; kind: LetterRelationKind }[] {
  const children: { letter: DemoLetter; kind: LetterRelationKind }[] = [];
  for (const letter of letters) {
    if (!canSeeLetter(letter, actor)) continue;
    if (letter.nestedIn?.id === letterId) children.push({ letter, kind: 'nested_in' });
    else if (letter.replyTo?.id === letterId) children.push({ letter, kind: 'reply_to' });
  }
  return children;
}

const TREE_MAX_DEPTH = 8;
const TREE_MAX_NODES = 200;
const TREE_MAX_UP = 64;

/** Дерево «ёлочки» от корня цепочки (#461, Р2): вверх по родителям до корня,
 *  вниз DFS с капами; невидимые узлы исключаются молча (поддерево скрытого
 *  промежуточного не всплывает). null — письмо невидимо/не существует. */
export function letterTreeOf(
  letterId: string,
  actor: LetterActor,
  /** Демо-мир (тесты подставляют свою цепочку; по умолчанию — общий). */
  letters: readonly DemoLetter[] = demoLetters,
): LetterTreeResponse | null {
  const find = (id: string) => letters.find((letter) => letter.id === id);
  const requested = find(letterId);
  if (!requested || !canSeeLetter(requested, actor)) return null;
  let root = requested;
  for (let step = 0; step < TREE_MAX_UP; step += 1) {
    const parent = letterParentOf(root);
    const parentLetter = parent ? find(parent.ref.id) : undefined;
    if (!parentLetter || !canSeeLetter(parentLetter, actor)) break;
    root = parentLetter;
  }
  let nodes = 0;
  let truncated = false;
  const build = (
    letter: DemoLetter,
    relation: { id: string; kind: LetterRelationKind } | null,
    depth: number,
  ): LetterTreeNode | null => {
    nodes += 1;
    if (nodes > TREE_MAX_NODES) {
      truncated = true;
      return null;
    }
    const children: LetterTreeNode[] = [];
    const kids = letterChildrenOf(letter.id, actor, letters);
    // Зеркало сервера (ред. 05.11.2026): глубина растёт только на ветвлении —
    // ЕДИНСТВЕННЫЙ ответ продолжает ствол цепочки на том же уровне.
    const replies = kids.filter((child) => child.kind === 'reply_to').length;
    if (depth < TREE_MAX_DEPTH) {
      for (const child of kids) {
        const chain = child.kind === 'reply_to' && replies === 1;
        const node = build(
          child.letter,
          { id: relationIdOf(child.letter.id, child.kind), kind: child.kind },
          chain ? depth : depth + 1,
        );
        if (node) children.push(node);
      }
    } else if (kids.length > 0) {
      truncated = true;
    }
    return {
      id: letter.id,
      regNumber: letter.regNumber,
      theirNumber: letter.theirNumber,
      subject: letter.subject,
      direction: letter.direction,
      systemState: letter.stage.systemState,
      confidential: letter.confidential,
      relationId: relation?.id ?? null,
      relationKind: relation?.kind ?? null,
      children,
    };
  };
  const tree = build(root, null, 0);
  if (!tree) return null;
  return { root: tree, truncated };
}
