import type { ChatMessage } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { localDayDiff, localDayNumber } from '../lib/local-day.js';

/**
 * Группировка ленты на серии (план docs/mvp/archive/chat-messages-plan.md, вердикт
 * владельца 14.09.2026, канон Телеграма/Битрикс24): подряд идущие сообщения
 * одного автора — одна серия (run). В серии: имя — только у первого чужого
 * сообщения, аватар и хвостик пузыря — только у последнего. Серия рвётся
 * ТОЛЬКО по смене автора или смене календарного дня (UTC-дата `createdAt`);
 * временного порога внутри дня НЕТ. Реакции, вложения, правки, цитаты и
 * оптимистичные (pending) сообщения серию не рвут. Надгробие удалённого
 * сообщения (#163, вердикт владельца 30.09 «по ответам») участвует в серии
 * СВОЕГО автора как обычное сообщение: пузырь с аватаром и метой — якорь
 * цепочки ответов; контент внутри приглушённый (tombstone.tsx).
 * Чистые функции — детерминированные unit-тесты без DOM.
 */
export interface MessageRun {
  authorId: string;
  mine: boolean;
  /** Первое сообщение серии — несёт имя автора (чужое, в групповых). */
  first: ChatMessage;
  /** Последнее сообщение серии — несёт аватар и хвостик пузыря. */
  last: ChatMessage;
  items: ChatMessage[];
}

const dayNumber = (iso: string): number => localDayNumber(new Date(iso));

export function buildMessageRuns(messages: ChatMessage[], meId?: string): MessageRun[] {
  const runs: MessageRun[] = [];
  for (const message of messages) {
    const run = runs[runs.length - 1];
    if (
      run &&
      run.authorId === message.author.id &&
      dayNumber(run.last.createdAt) === dayNumber(message.createdAt)
    ) {
      run.items.push(message);
      run.last = message;
      continue;
    }
    runs.push({
      authorId: message.author.id,
      mine: message.author.id === meId,
      first: message,
      last: message,
      items: [message],
    });
  }
  return runs;
}

/** Ставить ли дата-чип перед сообщением: смена локального дня относительно
 *  предыдущего (или начало ленты — чип первого дня ставится всегда). */
export function startsNewDay(prev: ChatMessage | undefined, cur: ChatMessage): boolean {
  return !prev || dayNumber(prev.createdAt) !== dayNumber(cur.createdAt);
}

/** Метка дата-чипа: «Сегодня» / «Вчера» / «5 сентября» (Intl ru-RU); для
 *  прошлых лет — с годом («4 октября 2025», витрина вложений живёт месяцами).
 *  Границы дня — локальные (не UTC, #782); `now` инжектируется для тестов. */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const day = new Date(iso);
  const diffDays = localDayDiff(iso, now);
  if (diffDays === 0) return ui.chat.today;
  if (diffDays === 1) return ui.chat.yesterday;
  const label = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(day);
  return day.getFullYear() === now.getFullYear() ? label : `${label} ${day.getFullYear()}`;
}
