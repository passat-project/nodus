import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  type Handler = (arg: unknown) => void;
  class FakeWorker {
    static instances: FakeWorker[] = [];
    readonly handlers = new Map<string, Handler[]>();
    readonly terminate = vi.fn(async () => 0);
    constructor(
      readonly url: URL,
      readonly options: unknown,
    ) {
      FakeWorker.instances.push(this);
    }
    once(event: string, handler: Handler): this {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
      return this;
    }
    emit(event: string, arg?: unknown): void {
      for (const handler of this.handlers.get(event) ?? []) handler(arg);
    }
  }
  return { FakeWorker };
});

vi.mock('node:worker_threads', () => ({ Worker: fake.FakeWorker }));

import { FILE_TEXT_LIMITS } from './file-text.config.js';
import { runExtractionInWorker } from './file-text.runner.js';

/**
 * Изоляция разбора в worker-потоке (#922, ADR-0050 п. 7): крафтовый файл не
 * должен блокировать event loop API. Тест держит контракт раннера: ответ,
 * ошибка с кодом, таймаут и обрыв запроса УБИВАЮТ поток (`terminate`).
 */

const extracted = {
  kind: 'docx' as const,
  pages: [{ page: 1, text: 'Текст' }],
  totalPages: null,
  chars: 5,
  truncated: false,
  scannedPages: [],
};

const lastWorker = (): (typeof fake.FakeWorker.instances)[number] =>
  fake.FakeWorker.instances[fake.FakeWorker.instances.length - 1]!;

beforeEach(() => {
  fake.FakeWorker.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runExtractionInWorker', () => {
  it('возвращает результат из потока и отпускает его terminate', async () => {
    const promise = runExtractionInWorker(Buffer.from('data'), 'docx');
    const worker = lastWorker();
    worker.emit('message', { ok: true, value: extracted });
    await expect(promise).resolves.toEqual(extracted);
    expect(worker.terminate).toHaveBeenCalled();
    expect(worker.url.pathname).toContain('file-text.worker.js');
    // Потолок кучи воркера: OOM не должен ронять процесс API.
    expect(worker.options).toMatchObject({
      resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 },
    });
  });

  it('код ошибки разбора доезжает до сервиса', async () => {
    const promise = runExtractionInWorker(Buffer.from('data'), 'docx');
    const expectation = expect(promise).rejects.toMatchObject({
      code: 'FILE_TEXT_TOO_LARGE',
    });
    lastWorker().emit('message', { ok: false, code: 'FILE_TEXT_TOO_LARGE' });
    await expectation;
    expect(lastWorker().terminate).toHaveBeenCalled();
  });

  it('неизвестный ответ/падение потока — FILE_TEXT_INVALID', async () => {
    const promise = runExtractionInWorker(Buffer.from('data'), 'docx');
    const expectation = expect(promise).rejects.toMatchObject({ code: 'FILE_TEXT_INVALID' });
    lastWorker().emit('error', new Error('boom'));
    await expectation;
  });

  it('поток завершился без ответа — FILE_TEXT_INVALID, а не зависание', async () => {
    const promise = runExtractionInWorker(Buffer.from('data'), 'docx');
    const expectation = expect(promise).rejects.toMatchObject({ code: 'FILE_TEXT_INVALID' });
    lastWorker().emit('exit', 1);
    await expectation;
  });

  it('таймаут уничтожает поток и отвечает FILE_TEXT_TIMEOUT', async () => {
    vi.useFakeTimers();
    const promise = runExtractionInWorker(Buffer.from('data'), 'docx');
    const worker = lastWorker();
    const expectation = expect(promise).rejects.toMatchObject({ code: 'FILE_TEXT_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(FILE_TEXT_LIMITS.timeoutMs + 1);
    await expectation;
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('обрыв запроса клиентом убивает поток, если результат больше не нужен', async () => {
    const controller = new AbortController();
    const promise = runExtractionInWorker(Buffer.from('data'), 'docx', controller.signal);
    const worker = lastWorker();
    const expectation = expect(promise).rejects.toMatchObject({ code: 'FILE_TEXT_TIMEOUT' });
    controller.abort();
    await expectation;
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('уже оборванный signal не запускает поток', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runExtractionInWorker(Buffer.from('data'), 'docx', controller.signal),
    ).rejects.toMatchObject({ code: 'FILE_TEXT_TIMEOUT' });
    expect(fake.FakeWorker.instances).toHaveLength(0);
  });
});
