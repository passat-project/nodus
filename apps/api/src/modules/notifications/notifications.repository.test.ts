import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/client.js';

import type { PrismaService } from '../../core/database/prisma.service.js';
import { NotificationsRepository } from './notifications.repository.js';

/** Текст SQL без лишних пробелов (Prisma.Sql.sql — шаблон с `?`/`$n`). */
function sqlText(query: Prisma.Sql): string {
  return query.sql.replace(/\s+/g, ' ').trim();
}

function makeRepo(prisma: Partial<Record<'$queryRaw' | '$executeRaw', unknown>>) {
  return new NotificationsRepository(
    prisma as unknown as PrismaService,
    { messageAliveGuard: vi.fn() } as never,
    { findRefs: vi.fn(async () => []) } as never,
  );
}

describe('NotificationsRepository.upsertSettings', () => {
  it('частичный патч — один INSERT … ON CONFLICT DO UPDATE с COALESCE, без чтения перед записью', async () => {
    const $queryRaw = vi.fn(async () => [
      { dnd_enabled: true, dnd_start: '23:00', dnd_end: '07:00' },
    ]);
    const repo = makeRepo({ $queryRaw });

    const result = await repo.upsertSettings('00000000-0000-4000-8000-000000000001', {
      dndEnabled: true,
    });

    expect($queryRaw).toHaveBeenCalledTimes(1); // нет read-modify-write
    const query = ($queryRaw.mock.calls[0] as unknown as [Prisma.Sql])[0];
    const text = sqlText(query);
    expect(text).toMatch(/INSERT INTO notification_settings/);
    expect(text).toMatch(/ON CONFLICT \(user_id\) DO UPDATE SET/);
    expect(text).toMatch(/dnd_start = COALESCE\(.+::text, notification_settings\.dnd_start\)/);
    expect(text).toMatch(/RETURNING dnd_enabled, dnd_start, dnd_end/);
    // поля вне патча уходят NULL-ами → COALESCE берёт текущее значение строки
    expect(query.values).toEqual(expect.arrayContaining([true, null]));
    // ответ — итоговая строка из БД, а не локальная склейка
    expect(result).toEqual({ dndEnabled: true, dndStart: '23:00', dndEnd: '07:00' });
  });
});

describe('NotificationsRepository.stopRepeats (#770)', () => {
  const USER = '00000000-0000-4000-8000-000000000001';
  const CONV = '00000000-0000-4000-8000-0000000000c1';

  it('прочтение по беседе ограничено watermark-ом source_seq <= upToSeq', async () => {
    const $executeRaw = vi.fn(async () => 2);
    const repo = makeRepo({ $executeRaw });

    await repo.stopRepeats(USER, { conversationId: CONV, upToSeq: 41 });

    const query = ($executeRaw.mock.calls[0] as unknown as [Prisma.Sql])[0];
    const text = sqlText(query);
    expect(text).toMatch(/source_id = .+::uuid AND source_seq <= .+::bigint/);
    expect(query.values).toEqual(expect.arrayContaining([CONV, 41n]));
    expect(text).toMatch(/priority = 'urgent'/);
    expect(text).toMatch(/repeats_stopped_at IS NULL/);
  });

  it('реакция по сообщению и ответ автора — без границы seq (весь скоуп)', async () => {
    const $executeRaw = vi.fn(async () => 1);
    const repo = makeRepo({ $executeRaw });

    await repo.stopRepeats(USER, { messageId: '00000000-0000-4000-8000-0000000000ff' });
    await repo.stopRepeats(USER, { conversationId: CONV });

    const byMessage = sqlText(($executeRaw.mock.calls[0] as unknown as [Prisma.Sql])[0]);
    const byConversation = sqlText(($executeRaw.mock.calls[1] as unknown as [Prisma.Sql])[0]);
    expect(byMessage).toMatch(/message_id = .+::uuid/);
    expect(byConversation).toMatch(/source_id = .+::uuid/);
    expect(byConversation).not.toMatch(/source_seq/);
  });
});

describe('NotificationsRepository.archiveStaleLow', () => {
  it('батчами: цикл, пока батч полный; сумма архивированного', async () => {
    const $executeRaw = vi
      .fn()
      .mockResolvedValueOnce(1_000)
      .mockResolvedValueOnce(1_000)
      .mockResolvedValueOnce(17);
    const repo = makeRepo({ $executeRaw });

    const total = await repo.archiveStaleLow(7);

    expect(total).toBe(2_017);
    expect($executeRaw).toHaveBeenCalledTimes(3);
    const text = sqlText(($executeRaw.mock.calls[0] as [Prisma.Sql])[0]);
    expect(text).toMatch(/WITH batch AS \( SELECT id FROM notifications/);
    expect(text).toMatch(/LIMIT .+ FOR UPDATE SKIP LOCKED/);
    expect(text).toMatch(/UPDATE notifications SET read_at = now\(\) FROM batch/);
    // граница возраста одна на весь проход
    const cutoffs = $executeRaw.mock.calls.map((c) =>
      ((c as [Prisma.Sql])[0].values.find((v) => v instanceof Date) as Date).getTime(),
    );
    expect(new Set(cutoffs).size).toBe(1);
  });

  it('нечего архивировать — один запрос, ноль', async () => {
    const $executeRaw = vi.fn().mockResolvedValue(0);
    await expect(makeRepo({ $executeRaw }).archiveStaleLow(7)).resolves.toBe(0);
    expect($executeRaw).toHaveBeenCalledTimes(1);
  });
});
