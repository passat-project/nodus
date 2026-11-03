import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailInboxService } from './mail-inbox.service.js';
import type { MailClient, MailboxStatus } from './mail-client.port.js';
import type { MailLetterWriter, LetterWriteOutcome } from './mail-letter-writer.js';
import { MailReceptionConfig } from './mail-reception.config.js';

interface SourceRow {
  id: string;
  code: string;
  uidValidity: bigint | null;
  lastUid: bigint | null;
  consecutiveFailures: number;
  lastNotifiedAt: Date | null;
  lastError: string | null;
}

function fakes(uids: bigint[], opts: { flagOn?: boolean; imapConfigured?: boolean } = {}) {
  const source: SourceRow = {
    id: 'src-1',
    code: 'chancery',
    uidValidity: null,
    lastUid: null,
    consecutiveFailures: 0,
    lastNotifiedAt: null,
    lastError: null,
  };
  const state = { connected: false, closed: 0, statusCalls: 0 };
  const uidValidity = { value: 111n };
  const client: MailClient = {
    get connected() {
      return state.connected;
    },
    async connect() {
      state.connected = true;
    },
    async close() {
      state.connected = false;
      state.closed += 1;
    },
    async status(): Promise<MailboxStatus> {
      state.statusCalls += 1;
      return { uidValidity: uidValidity.value, uidNext: 500n, exists: uids.length };
    },
    searchAfter: async (after: bigint) => uids.filter((uid) => uid > after),
    maxUid: async () => (uids.length > 0 ? uids[uids.length - 1]! : 0n),
    async source() {
      throw new Error('не используется — writer фейковый');
    },
    async internalDateOf() {
      return new Date();
    },
    onExists() {
      return true;
    },
    onClose() {
      return undefined;
    },
  };
  const writes: bigint[] = [];
  // «Транзакция» теста — сам фейковый prisma (внутри mailSource.update);
  // объявлен ниже, поэтому writer берёт его через ref.
  const prismaRef: { current?: unknown } = {};
  const writer = {
    async write(
      _client: MailClient,
      uid: bigint,
      onLastUid: (tx: unknown, uid: bigint) => Promise<void>,
    ): Promise<LetterWriteOutcome> {
      writes.push(uid);
      await onLastUid(prismaRef.current, uid);
      return { advance: true, created: true };
    },
  } as unknown as MailLetterWriter;
  const prisma = {
    mailSource: {
      findUnique: async () => source,
      create: async () => source,
      update: async (args: {
        data: Partial<SourceRow> & { consecutiveFailures?: { increment: number } };
      }) => {
        Object.assign(source, args.data, {
          consecutiveFailures:
            args.data.consecutiveFailures && typeof args.data.consecutiveFailures === 'object'
              ? source.consecutiveFailures + 1
              : ((args.data.consecutiveFailures as number | undefined) ??
                source.consecutiveFailures),
        });
        return source;
      },
    },
    $queryRaw: async () => [{ locked: true }],
  };
  const emitted: { type: string; payload: Record<string, unknown> }[] = [];
  const txRunner = { run: async (cb: (tx: unknown) => Promise<void>) => cb(prismaRef.current) };
  prismaRef.current = prisma;
  const eventBus = {
    emit: async (_tx: unknown, type: string, payload: Record<string, unknown>) => {
      emitted.push({ type, payload });
    },
  };
  const flags = { isEnabled: async () => opts.flagOn ?? true };
  const config = new MailReceptionConfig(
    opts.imapConfigured === false
      ? {}
      : {
          MAIL_IMAP_HOST: 'imap.test',
          MAIL_IMAP_USER: 'u',
          MAIL_IMAP_PASSWORD: 'p',
        },
  );
  const warns: unknown[][] = [];
  const logger = {
    setContext() {},
    info() {},
    warn: (...args: unknown[]) => {
      warns.push(args);
    },
    error() {},
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
    advanceCursor: async (tx: unknown, _id: string, lastUid: bigint) => {
      source.lastUid = lastUid;
      void tx;
    },
    recordSuccess: async (id: string) => {
      source.consecutiveFailures = 0;
      source.lastError = null;
      void id;
    },
    recordFailure: async (_code: string, message: string) => {
      source.consecutiveFailures += 1;
      source.lastError = message;
      return source;
    },
  };
  const lock = {
    tryAcquire: async () => true,
    release: async () => undefined,
  };
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
  return { service, source, writes, emitted, state, uidValidity, client, prisma, warns };
}

/** Текстовые части warn-вызова: pino кладёт объект первым, сообщение — строкой. */
function warnMessages(warns: unknown[][]): string[] {
  return warns.map((args) =>
    args.filter((arg): arg is string => typeof arg === 'string').join(' '),
  );
}

describe('MailInboxService: цикл приёма на фейке порта (#56, Р3/Р4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('первый запуск: курсор на максимум UID, старое не импортируется (В5)', async () => {
    const { service, source, writes } = fakes([10n, 20n, 30n]);
    const result = await service.sync('poll');
    expect(result.ran).toBe(true);
    expect(result.created).toBe(0);
    expect(writes).toEqual([]);
    expect(source.lastUid).toBe(30n);
    expect(source.uidValidity).toBe(111n);
  });

  it('обычный цикл: письма после курсора по возрастанию, курсор доезжает до конца', async () => {
    const { service, source, writes } = fakes([10n, 20n, 30n]);
    await service.sync('poll'); // первый запуск — курсор 30
    const result = await service.sync('poll');
    expect(result.created).toBe(0);
    source.uidValidity = 111n; // уже установлен
    writes.length = 0;
    // Новых нет: searchAfter(30n) пуст — ок.
    expect(source.lastUid).toBe(30n);
  });

  it('смена UIDVALIDITY: полный переобход с нуля под дедупом', async () => {
    const { service, source, writes, uidValidity } = fakes([10n, 20n]);
    await service.sync('poll');
    expect(writes).toEqual([]);
    uidValidity.value = 999n; // ящик пересоздали
    const result = await service.sync('idle');
    expect(result.created).toBe(2);
    expect(writes).toEqual([10n, 20n]);
    expect(source.uidValidity).toBe(999n);
    expect(source.lastUid).toBe(20n);
  });

  it('аккумулятор порога: ≥3 неудач → mail_sync_failed раз в 24 ч; успех сбрасывает', async () => {
    const broken = fakes([5n]);
    // Падающий порт: статус недоступен — каждый цикл неудачен.
    broken.client.status = async () => {
      throw new Error('сеть недоступна');
    };
    await broken.service.sync('poll').catch(() => undefined);
    await broken.service.sync('poll').catch(() => undefined);
    expect(broken.emitted).toEqual([]);
    await broken.service.sync('poll').catch(() => undefined);
    const syncFailed = broken.emitted.find((e) => e.type === 'correspondence.mail_sync_failed');
    expect(syncFailed?.payload.attempts).toBe(3);
    expect(syncFailed?.payload.sourceCode).toBe('chancery');
    // Троттлинг: четвёртая неудача в те же сутки — без нового события.
    await broken.service.sync('poll').catch(() => undefined);
    expect(broken.emitted.filter((e) => e.type === 'correspondence.mail_sync_failed')).toHaveLength(
      1,
    );
  });

  it('выключенный рубильник: цикл пропущен, соединение разорвано (I10)', async () => {
    const { service, state, warns } = fakes([5n], { flagOn: false });
    const result = await service.sync('poll');
    expect(result.ran).toBe(false);
    expect(state.connected).toBe(false);
    // Причина видна в логе один раз, а не тишина (#577).
    const messages = warnMessages(warns);
    expect(messages.filter((m) => m.includes('mail-reception'))).toHaveLength(1);
  });

  it('нет MAIL_IMAP_*: в логе названа причина, соединения нет (#577)', async () => {
    const { service, state, warns } = fakes([5n], { imapConfigured: false });
    const result = await service.sync('poll');
    expect(result.ran).toBe(false);
    expect(state.connected).toBe(false);
    // Таймер перепроверяет состояние каждые 30 с — спама быть не должно.
    await service.sync('poll');
    const messages = warnMessages(warns);
    expect(messages.filter((m) => m.includes('MAIL_IMAP_'))).toHaveLength(1);
  });
});
