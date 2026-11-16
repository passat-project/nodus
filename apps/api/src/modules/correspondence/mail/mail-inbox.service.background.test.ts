import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailInboxService } from './mail-inbox.service.js';
import type { MailClient, MailboxStatus } from './mail-client.port.js';
import type { LetterWriteOutcome, MailLetterWriter } from './mail-letter-writer.js';
import { MailReceptionConfig } from './mail-reception.config.js';

interface SourceRow {
  id: string;
  code: string;
  uidValidity: bigint;
  lastUid: bigint;
  consecutiveFailures: number;
}

type BackgroundHook = (() => void) | null;
type Hooks = { exists: BackgroundHook; close: BackgroundHook };

/** Фейк порта и репозиториев для фоновых запусков: таймеры, счётчики, UID. */
function fakes(uids: bigint[] = [], opts: { failUids?: (uid: bigint) => boolean } = {}) {
  const source: SourceRow = {
    id: 'src-1',
    code: 'chancery',
    uidValidity: 111n,
    lastUid: 0n,
    consecutiveFailures: 0,
  };
  const state = { connected: false };
  const hooks: Hooks = { exists: null, close: null };
  const client: MailClient = {
    get connected() {
      return state.connected;
    },
    async connect() {
      state.connected = true;
    },
    async close() {
      state.connected = false;
    },
    async status(): Promise<MailboxStatus> {
      return { uidValidity: 111n, uidNext: 500n, exists: uids.length };
    },
    searchAfter: async (after: bigint) => uids.filter((uid) => uid > after),
    maxUid: async () => (uids.length > 0 ? uids[uids.length - 1]! : 0n),
    async source() {
      return null;
    },
    async internalDateOf() {
      return new Date();
    },
    onExists(callback: () => void) {
      hooks.exists = callback;
      return true;
    },
    onClose(callback: () => void) {
      hooks.close = callback;
    },
  };
  const writes: bigint[] = [];
  const prisma = {
    mailSource: {
      update: async () => source,
    },
  };
  const writer = {
    async write(
      _client: MailClient,
      uid: bigint,
      onLastUid: (tx: unknown, uid: bigint) => Promise<void>,
    ): Promise<LetterWriteOutcome> {
      writes.push(uid);
      if (opts.failUids?.(uid)) throw new Error('запись письма не удалась');
      await onLastUid(prisma, uid);
      return { advance: true, created: true };
    },
  } as unknown as MailLetterWriter;
  const emitted: { type: string; payload: Record<string, unknown> }[] = [];
  const txRunner = { run: async (cb: (tx: unknown) => Promise<void>) => cb(prisma) };
  const eventBus = {
    emit: async (_tx: unknown, type: string, payload: Record<string, unknown>) => {
      emitted.push({ type, payload });
    },
  };
  const flags = { isEnabled: async () => true };
  const config = new MailReceptionConfig({
    MAIL_IMAP_HOST: 'imap.test',
    MAIL_IMAP_USER: 'u',
    MAIL_IMAP_PASSWORD: 'p',
  });
  const logs: { level: 'warn' | 'error'; args: unknown[] }[] = [];
  const logger = {
    setContext() {},
    info() {},
    warn: (...args: unknown[]) => {
      logs.push({ level: 'warn', args });
    },
    error: (...args: unknown[]) => {
      logs.push({ level: 'error', args });
    },
  };
  const sourcesRepo = {
    ensure: async () => source,
    initializeCursor: async (_id: string, uidValidity: bigint, lastUid: bigint) => {
      source.uidValidity = uidValidity;
      source.lastUid = lastUid;
    },
    resetCursor: async (_id: string, uidValidity: bigint) => {
      source.uidValidity = uidValidity;
      source.lastUid = 0n;
    },
    advanceCursor: async (_tx: unknown, _id: string, lastUid: bigint) => {
      source.lastUid = lastUid;
    },
    recordSuccess: async () => {
      source.consecutiveFailures = 0;
    },
    recordFailure: async () => {
      source.consecutiveFailures += 1;
      return source;
    },
  };
  const lock = { tryAcquire: async () => true, release: async () => undefined };
  const service = new MailInboxService(
    client,
    writer,
    flags as never,
    config,
    sourcesRepo as never,
    lock as never,
    txRunner as never,
    eventBus as never,
    logger as never,
  );
  return { service, client, source, writes, emitted, state, hooks, flags, logs };
}

/** Текстовые части error-лога: pino кладёт объект первым, сообщение — строкой. */
function errorMessages(logs: { level: string; args: unknown[] }[]): string[] {
  return logs
    .filter((log) => log.level === 'error')
    .map((log) => log.args.filter((arg): arg is string => typeof arg === 'string').join(' '));
}

/** Метки фоновых запусков из структурного поля task. */
function errorTasks(logs: { level: string; args: unknown[] }[]): unknown[] {
  return logs
    .filter((log) => log.level === 'error')
    .map((log) =>
      typeof log.args[0] === 'object' && log.args[0] !== null
        ? (log.args[0] as { task?: unknown }).task
        : undefined,
    );
}

/** Собирает необработанные отказы, чтобы падение фонового запуска было видно тесту. */
function collectRejections(): { rejections: unknown[]; stop: () => void } {
  const rejections: unknown[] = [];
  const listener = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on('unhandledRejection', listener);
  return { rejections, stop: () => process.off('unhandledRejection', listener) };
}

/** Даёт «выстрелил и забыл» промисам шанс завершиться до проверки. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await Promise.resolve();
  }
}

/** Переход на реальные таймеры и проверка, что фон не оставил необработанных отказов. */
async function expectNoUnhandledRejections(
  service: MailInboxService,
  collector: { rejections: unknown[] },
): Promise<void> {
  await service.onModuleDestroy();
  vi.useRealTimers();
  await new Promise((resolve) => setImmediate(resolve));
  expect(collector.rejections).toEqual([]);
}

describe('MailInboxService: фоновые запуски не роняют процесс (AUD-018)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('idle-цикл по таймеру падает: отказ пойман, счётчик неудач вырос', async () => {
    vi.useFakeTimers();
    const collector = collectRejections();
    const f = fakes([5n]);
    f.client.status = async () => {
      throw new Error('сеть недоступна');
    };
    try {
      f.service.onModuleInit();
      await vi.advanceTimersByTimeAsync(0);
      f.hooks.exists?.(); // IMAP EXISTS → дебаунс → цикл по таймеру
      await vi.advanceTimersByTimeAsync(2_000);
      await flushMicrotasks();
      expect(f.source.consecutiveFailures).toBe(1);
      expect(errorMessages(f.logs).some((m) => m.includes('Цикл приёма не удался'))).toBe(true);
      expect(errorTasks(f.logs)).toContain('idle-sync');
      await expectNoUnhandledRejections(f.service, collector);
    } finally {
      collector.stop();
      vi.useRealTimers();
    }
  });

  it('проверка флага по таймеру бросает: отказ пойман, процесс живёт', async () => {
    vi.useFakeTimers();
    const collector = collectRejections();
    const f = fakes();
    f.flags.isEnabled = async () => {
      throw new Error('база недоступна');
    };
    try {
      f.service.onModuleInit(); // первичный запуск тоже бросает
      await vi.advanceTimersByTimeAsync(30_000); // тик setInterval
      await flushMicrotasks();
      const tasks = errorTasks(f.logs);
      expect(tasks).toContain('startup');
      expect(tasks).toContain('flag-check');
      await expectNoUnhandledRejections(f.service, collector);
    } finally {
      collector.stop();
      vi.useRealTimers();
    }
  });

  it('реконнект по таймеру бросает: отказ пойман', async () => {
    vi.useFakeTimers();
    const collector = collectRejections();
    const f = fakes();
    try {
      f.service.onModuleInit();
      await vi.advanceTimersByTimeAsync(0);
      f.flags.isEnabled = async () => {
        throw new Error('база недоступна');
      };
      f.hooks.close?.(); // IMAP закрылся → реконнект 5 с (jitter ≤ 6 с)
      await vi.advanceTimersByTimeAsync(6_500);
      await flushMicrotasks();
      expect(errorTasks(f.logs)).toContain('reconnect');
      await expectNoUnhandledRejections(f.service, collector);
    } finally {
      collector.stop();
      vi.useRealTimers();
    }
  });

  it('повтор авторизации по таймеру бросает: отказ пойман', async () => {
    vi.useFakeTimers();
    const collector = collectRejections();
    const f = fakes();
    f.client.connect = async () => {
      throw Object.assign(new Error('отказ авторизации'), { authenticationFailed: true });
    };
    try {
      f.service.onModuleInit();
      await vi.advanceTimersByTimeAsync(0); // отказ авторизации → проба через 15 минут
      f.flags.isEnabled = async () => {
        throw new Error('база недоступна');
      };
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      await flushMicrotasks();
      expect(errorTasks(f.logs)).toContain('auth-retry');
      await expectNoUnhandledRejections(f.service, collector);
    } finally {
      collector.stop();
      vi.useRealTimers();
    }
  });
});

describe('MailInboxService: проблемное письмо не останавливает приём (AUD-019)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('поток из трёх писем: второе стабильно падает — после трёх попыток пропущено, третье принято', async () => {
    const f = fakes([10n, 20n, 30n], { failUids: (uid) => uid === 20n });
    await expect(f.service.sync('poll')).rejects.toThrow('запись письма не удалась');
    expect(f.source.lastUid).toBe(10n);
    await expect(f.service.sync('poll')).rejects.toThrow('запись письма не удалась');
    expect(f.source.lastUid).toBe(10n);
    // Третья неудача подряд: UID 20 пропускается, UID 30 принимается в этом же цикле.
    const third = await f.service.sync('poll');
    expect(third.created).toBe(1);
    expect(f.source.lastUid).toBe(30n);
    expect(f.writes).toEqual([10n, 20n, 20n, 20n, 30n]);
    const skipped = f.logs.find(
      (log) =>
        log.level === 'error' &&
        log.args.some((arg) => typeof arg === 'string' && arg.includes('Письмо пропущено')),
    );
    expect(skipped).toBeDefined();
    const meta = skipped!.args.find((arg) => typeof arg === 'object' && arg !== null) as
      { uid?: string; attempts?: number } | undefined;
    expect(meta?.uid).toBe('20');
    expect(meta?.attempts).toBe(3);
  });

  it('временный сбой одного цикла: письмо не пропускается, принимается следующим циклом', async () => {
    let failures = 1;
    const f = fakes([10n, 20n, 30n], {
      failUids: (uid) => uid === 20n && failures-- > 0,
    });
    await expect(f.service.sync('poll')).rejects.toThrow('запись письма не удалась');
    expect(f.source.lastUid).toBe(10n);
    const second = await f.service.sync('poll');
    expect(second.created).toBe(2);
    expect(f.source.lastUid).toBe(30n);
    expect(
      f.logs.some(
        (log) =>
          log.level === 'error' &&
          log.args.some((arg) => typeof arg === 'string' && arg.includes('Письмо пропущено')),
      ),
    ).toBe(false);
  });
});
