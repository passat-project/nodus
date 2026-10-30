import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailLetterWriter } from './mail-letter-writer.js';
import { MailReceptionConfig } from './mail-reception.config.js';
import type { MailClient } from './mail-client.port.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');

interface StorageFake {
  saved: { fileId: string; name: string; mime: string; size: number; bytes: number }[];
  removed: string[];
  save(
    input: { name: string; mime: string; size: number },
    content: Readable,
  ): Promise<{ fileId: string }>;
  remove(fileIds: string[]): Promise<void>;
}

function makeFakes(takenMessageIds: string[] = []) {
  const createdLetters: Record<string, unknown>[] = [];
  const links: { letterId: string; relatedLetterId: string; source: string }[] = [];
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const storage: StorageFake = {
    saved: [],
    removed: [],
    async save(input, content) {
      // Порт обязан прочитать поток до ответа (file-storage.port.ts: байты
      // контента должны попасть в хранилище — так и делает putObject).
      // Неконсумированный ReadStream переживает тест, а rm временного каталога
      // обгоняет его асинхронный open — поздний ENOENT приходит unhandled (#537).
      let bytes = 0;
      for await (const chunk of content) {
        bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : (chunk as Buffer).length;
      }
      const fileId = `file-${storage.saved.length + 1}`;
      storage.saved.push({ fileId, ...input, bytes });
      return { fileId };
    },
    async remove(fileIds) {
      storage.removed.push(...fileIds);
    },
  };
  const repo = {
    mailMessageIdTaken: async (id: string) => takenMessageIds.includes(id),
    findByMailMessageIds: async (ids: readonly string[]) =>
      ids.includes('out-1@passat.by')
        ? [
            {
              id: 'letter-out',
              regNumber: 'Исх-2026/1',
              subject: 'Оферта',
              mailMessageId: 'out-1@passat.by',
            },
          ]
        : [],
    create: async (_tx: unknown, data: Record<string, unknown>) => {
      createdLetters.push(data);
      return data;
    },
    linkReplyTo: async (
      _tx: unknown,
      letterId: string,
      relatedLetterId: string,
      source: string,
    ) => {
      links.push({ letterId, relatedLetterId, source });
      return true;
    },
  };
  const threading = {
    autoReplyTarget: async (inReplyTo: string | null, references: unknown) => {
      const all = [
        ...(typeof inReplyTo === 'string' ? [inReplyTo] : []),
        ...(Array.isArray(references) ? references.map(String) : []),
      ];
      const known = all.filter((id) => id === 'out-1@passat.by');
      return known.length > 0
        ? { id: 'letter-out', regNumber: 'Исх-2026/1', subject: 'Оферта' }
        : null;
    },
  };
  const txRunner = { run: async (cb: (tx: unknown) => Promise<void>) => cb({}) };
  const eventBus = {
    emit: async (_tx: unknown, type: string, payload: Record<string, unknown>) => {
      events.push({ type, payload });
    },
  };
  const catalog = {
    resolveTypeByCode: async () => ({
      id: 'type-in',
      workflowId: 'wf-1',
    }),
    liveStages: async () => [{ id: 'stage-new', isInitial: true, systemState: 'backlog' }],
  };
  const dictionaries = {
    activeItemByCode: async () => ({ id: 'receipt-email', name: 'Электронная почта' }),
  };
  const writer = new MailLetterWriter(
    repo as never,
    threading as never,
    new MailReceptionConfig({}),
    txRunner as never,
    eventBus as never,
    { parse: vi.fn() } as never, // парсер подменяем ниже реальным сервисом
    storage as never,
    catalog as never,
    dictionaries as never,
    { enqueue: vi.fn(async () => void 0) } as never,
  );
  return { writer, storage, createdLetters, links, events, repo };
}

/** Клиент-фейк: источник — файл фикстуры, INTERNALDATE фиксирована. */
function clientOf(fixture: string): MailClient {
  return {
    connected: true,
    async connect() {
      return undefined;
    },
    async close() {
      return undefined;
    },
    async status() {
      return { uidValidity: 1n, uidNext: 2n, exists: 1 };
    },
    async searchAfter() {
      return [1n];
    },
    async maxUid() {
      return 1n;
    },
    source(_uid: bigint, _maxBytes: number) {
      void _uid;
      void _maxBytes;
      const stat = import('node:fs/promises').then((fs) => fs.stat(join(FIXTURES, fixture)));
      return stat.then((info) => ({
        expectedSize: info.size,
        content: createReadStream(join(FIXTURES, fixture)),
      }));
    },
    async internalDateOf() {
      return new Date('2026-10-28T08:30:00Z');
    },
    onExists() {
      return true;
    },
    onClose() {
      return undefined;
    },
  };
}

describe('MailLetterWriter: письмо из исходника (#56, Р3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: конверт, роли файлов, inline/contentId, авто-связь, событие, курсор', async () => {
    const fakes = makeFakes();
    const { MailParserService } = await import('./mail-parser.service.js');
    // Подменяем фейковый парсер реальным (сервис-зависимость writer).
    (fakes.writer as unknown as { parser: unknown }).parser = new MailParserService();
    const cursorUpdates: bigint[] = [];
    const outcome = await fakes.writer.write(clientOf('reply-cid.eml'), 7n, async (_tx, uid) => {
      cursorUpdates.push(uid);
    });
    expect(outcome).toEqual({ advance: true, created: true });
    const letter = fakes.createdLetters[0]!;
    expect(letter.source).toBe('mail');
    expect(letter.mailMessageId).toBe('reply-offer@galurgiya.by');
    expect(letter.mailFromAddress).toBe('a.lukashevich@galurgiya.by');
    expect(letter.subject).toBe('RE: Договор-оферта на проектирование');
    expect(letter.receiptMethodId).toBe('receipt-email');
    const rows = letter.attachments as {
      create: { fileId: string; role: string; contentId: string | null; inline: boolean }[];
    };
    // Логотип (inline) и подпись .p7s — роль attachment; inline держит флаг.
    const roles = rows.create.map((row) => row.role).sort();
    expect(roles).toEqual(['attachment', 'attachment', 'body', 'source']);
    const inline = rows.create.find((row) => row.inline);
    expect(inline?.contentId).toBe('logo@psm-partner');
    // Хранилище дочитало каждый поток (драен фейка): байты = заявленному size,
    // исходник .eml доехал, а не остался висеть открытым до rm каталога (#537).
    expect(fakes.storage.saved.every((row) => row.bytes === row.size)).toBe(true);
    expect(fakes.storage.saved.some((row) => row.name === 'Исходное письмо.eml')).toBe(true);
    // Авто-связь по цепочке (Р5) — в той же транзакции создания.
    expect(fakes.links[0]?.relatedLetterId).toBe('letter-out');
    expect(fakes.links[0]?.source).toBe('auto');
    expect(fakes.events[0]?.type).toBe('correspondence.letter_received');
    expect(fakes.events[0]?.payload.subject).toBe('RE: Договор-оферта на проектирование');
    expect(cursorUpdates).toEqual([7n]);
  });

  it('дубль Message-ID: ни строки, ни файла — курсор вперёд', async () => {
    const fakes = makeFakes(['reply-offer@galurgiya.by']);
    const { MailParserService } = await import('./mail-parser.service.js');
    (fakes.writer as unknown as { parser: unknown }).parser = new MailParserService();
    const outcome = await fakes.writer.write(clientOf('reply-cid.eml'), 7n, async () => undefined);
    expect(outcome).toEqual({ advance: true, created: false });
    expect(fakes.createdLetters).toHaveLength(0);
    expect(fakes.storage.saved).toHaveLength(0);
  });

  it('51 вложение: храним 50, mailStorageIncomplete; тело — первый PDF главный', async () => {
    const fakes = makeFakes();
    const { MailParserService } = await import('./mail-parser.service.js');
    (fakes.writer as unknown as { parser: unknown }).parser = new MailParserService();
    await fakes.writer.write(clientOf('attachments-51.eml'), 3n, async () => undefined);
    const letter = fakes.createdLetters[0]!;
    expect(letter.mailStorageIncomplete).toBe(true);
    const rows = (letter.attachments as { create: unknown[] }).create;
    // У фикстуры 51 вложение и нет тела: 50 сохранённых + исходник .eml.
    expect(rows).toHaveLength(51);
  });

  it('компенсация: транзакция упала — файлы убраны из хранилища', async () => {
    const fakes = makeFakes();
    const { MailParserService } = await import('./mail-parser.service.js');
    (fakes.writer as unknown as { parser: unknown }).parser = new MailParserService();
    // Транзакция падает уже после записи файлов в хранилище.
    const failing = new MailLetterWriter(
      {
        ...fakes.repo,
        create: async () => {
          throw new Error('БД упала');
        },
      } as never,
      { autoReplyTarget: async () => null } as never,
      new MailReceptionConfig({}),
      { run: async (cb: (tx: unknown) => Promise<void>) => cb({}) } as never,
      { emit: async () => undefined } as never,
      new MailParserService(),
      fakes.storage as never,
      {
        resolveTypeByCode: async () => ({ id: 't', workflowId: 'w' }),
        liveStages: async () => [{ id: 's', isInitial: true, systemState: 'backlog' }],
      } as never,
      { activeItemByCode: async () => null } as never,
      { enqueue: vi.fn(async () => void 0) } as never,
    );
    await expect(failing.write(clientOf('win1251.eml'), 9n, async () => undefined)).rejects.toThrow(
      'БД упала',
    );
    // Убрано ровно то, что успели сохранить (тело + исходник).
    expect(fakes.storage.removed).toHaveLength(fakes.storage.saved.length);
  });
});
