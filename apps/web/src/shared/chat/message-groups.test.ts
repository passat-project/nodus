import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@nodus/contracts';

import { buildMessageRuns, formatDayLabel, startsNewDay } from './message-groups.js';

const msg = (id: string, authorId: string, createdAt: string): ChatMessage => ({
  id,
  conversationId: 'conv-1',
  seq: Number(id.replace(/\D/g, '')) || 1,
  clientMessageId: id,
  author: { id: authorId, displayName: `Имя ${authorId}`, avatarUrl: null },
  text: `текст ${id}`,
  replyToId: null,
  reply: null,
  deletedAt: null,
  pinned: false,
  forwardedFrom: null,
  threadRootId: null,
  threadRepliesCount: 0,
  reactions: [],
  attachments: [],
  editedAt: null,
  readAt: null,
  readBy: [],
  urgent: false,
  mentionedUserIds: [],
  linkPreview: null,
  createdAt,
});

/** Локальная метка времени (#782: границы дня — по поясу пользователя):
 *  тесты не зависят от пояса хоста прогона. */
const at = (y: number, m: number, d: number, h = 10, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

describe('buildMessageRuns — серии одного автора (план chat-messages-plan.md)', () => {
  it('чередование авторов — каждое сообщение своя серия, флаг mine по meId', () => {
    const runs = buildMessageRuns(
      [
        msg('1', 'a', at(2026, 9, 14, 9, 0)),
        msg('2', 'b', at(2026, 9, 14, 9, 1)),
        msg('3', 'a', at(2026, 9, 14, 9, 2)),
      ],
      'a',
    );
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.items.length)).toEqual([1, 1, 1]);
    expect(runs.map((r) => r.mine)).toEqual([true, false, true]);
  });

  it('подряд идущие сообщения одного автора — одна серия с порядком', () => {
    const runs = buildMessageRuns(
      [
        msg('1', 'a', at(2026, 9, 14, 9, 0)),
        msg('2', 'a', at(2026, 9, 14, 9, 1)),
        msg('3', 'b', at(2026, 9, 14, 9, 2)),
        msg('4', 'b', at(2026, 9, 14, 9, 3)),
        msg('5', 'b', at(2026, 9, 14, 9, 4)),
        msg('6', 'a', at(2026, 9, 14, 9, 5)),
      ],
      'a',
    );
    expect(runs.map((r) => r.items.length)).toEqual([2, 3, 1]);
    expect(runs[2]?.items[0]?.id).toBe('6');
  });

  it('пауза внутри дня серию НЕ рвёт (модель Телеграма: без порога минут)', () => {
    const runs = buildMessageRuns(
      [msg('1', 'a', at(2026, 9, 14, 8, 0)), msg('2', 'a', at(2026, 9, 14, 17, 30))],
      'a',
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.items).toHaveLength(2);
  });

  it('смена локального календарного дня рвёт серию того же автора (23:59 → 00:01)', () => {
    const runs = buildMessageRuns(
      [msg('1', 'a', at(2026, 9, 13, 23, 59)), msg('2', 'a', at(2026, 9, 14, 0, 1))],
      'a',
    );
    expect(runs).toHaveLength(2);
  });

  it('пустая лента и одно сообщение', () => {
    expect(buildMessageRuns([], 'a')).toEqual([]);
    const runs = buildMessageRuns([msg('1', 'a', at(2026, 9, 14, 9, 0))]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.mine).toBe(false);
  });
});

describe('startsNewDay — дата-чип (локальные границы, #782)', () => {
  it('перед первым сообщением ленты чип ставится всегда', () => {
    expect(startsNewDay(undefined, msg('1', 'a', at(2026, 9, 14, 9, 0)))).toBe(true);
  });

  it('тот же день — без чипа, другой день — чип', () => {
    const prev = msg('1', 'a', at(2026, 9, 14, 9, 0));
    expect(startsNewDay(prev, msg('2', 'a', at(2026, 9, 14, 18, 0)))).toBe(false);
    expect(startsNewDay(prev, msg('3', 'a', at(2026, 9, 15, 6, 0)))).toBe(true);
  });

  it('ночная граница — локальная: 00:05 и 23:59 — разные дни', () => {
    const lateNight = msg('1', 'a', at(2026, 9, 14, 23, 59));
    expect(startsNewDay(lateNight, msg('2', 'a', at(2026, 9, 15, 0, 5)))).toBe(true);
  });
});

describe('formatDayLabel — метка чипа (Intl ru-RU, now инжектирован)', () => {
  const now = new Date(2026, 8, 14, 12, 0);

  it('сегодня и вчера — строки i18n', () => {
    expect(formatDayLabel(at(2026, 9, 14, 8, 0), now)).toBe('Сегодня');
    expect(formatDayLabel(at(2026, 9, 13, 22, 0), now)).toBe('Вчера');
  });

  it('ночное сообщение (00:05) — «Сегодня», а не «Вчера» (#782: локальный день)', () => {
    expect(formatDayLabel(at(2026, 9, 14, 0, 5), now)).toBe('Сегодня');
  });

  it('старше — день и месяц по-русски; прошлый год — с годом', () => {
    expect(formatDayLabel(at(2026, 9, 5, 10, 0), now)).toBe('5 сентября');
    expect(formatDayLabel(at(2025, 10, 4, 10, 0), now)).toBe('4 октября 2025');
  });
});

describe('buildMessageRuns — надгробия (#163: участвуют в серии своего автора)', () => {
  const deleted = (id: string, authorId: string, at_iso: string): ChatMessage => ({
    ...msg(id, authorId, at_iso),
    deletedAt: at_iso,
    text: '',
  });

  it('надгробие НЕ рвёт серию своего автора (пузырь с аватаром — атрибуты серии)', () => {
    const runs = buildMessageRuns(
      [
        msg('1', 'a', at(2026, 9, 14, 9, 0)),
        deleted('2', 'a', at(2026, 9, 14, 9, 1)),
        msg('3', 'a', at(2026, 9, 14, 9, 2)),
      ],
      'a',
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]?.items.map((m) => m.id)).toEqual(['1', '2', '3']);
    expect(runs[0]?.last.id).toBe('3');
  });

  it('надгробие другого автора рвёт серию (смена автора — единственная причина)', () => {
    const runs = buildMessageRuns(
      [
        msg('1', 'a', at(2026, 9, 14, 9, 0)),
        deleted('2', 'b', at(2026, 9, 14, 9, 1)),
        msg('3', 'a', at(2026, 9, 14, 9, 2)),
      ],
      'a',
    );
    expect(runs).toHaveLength(3);
  });
});
