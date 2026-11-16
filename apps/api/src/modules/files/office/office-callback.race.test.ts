import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ATTEMPT_KEY,
  FILE_ID,
  SAVE_URL,
  makeFile,
  makeHarness,
  makeVersionRow,
  mockFetchOk,
} from './office-callback.test-helpers.js';

/** Гонка сохранений ONLYOFFICE (AUD-015, #866): замок строки файла,
 *  уникальный ключ объекта попытки, дедуп и компенсация в транзакции. */
describe('OfficeCallbackService: гонка сохранений (AUD-015)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchPerCall(contentLength: number): ReturnType<typeof vi.fn> {
    // Новый стрим на КАЖДЫЙ вызов: параллельные сохранения читают тело дважды.
    return vi.fn(async () => ({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.close();
        },
      }),
      headers: new Map([['content-length', String(contentLength)]]) as unknown as Headers,
      status: 200,
    }));
  }

  it('два параллельных колбэка загружают объекты по РАЗНЫМ ключам', async () => {
    vi.stubGlobal('fetch', mockFetchPerCall(2));
    const h = makeHarness(makeFile(1));
    await Promise.all([
      h.service.handle(FILE_ID, {
        status: 2,
        key: `${FILE_ID}.v1`,
        url: SAVE_URL,
        lastsave: '2026-09-28T20:00:00.000Z',
      }),
      h.service.handle(FILE_ID, {
        status: 2,
        key: `${FILE_ID}.v1`,
        url: SAVE_URL,
        lastsave: '2026-09-28T20:05:00.000Z',
      }),
    ]);
    const keys = h.mocks.put.mock.calls.map((call) => call[0]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) expect(key).toMatch(ATTEMPT_KEY);
  });

  it('дедуп внутри транзакции: устаревшее чтение до неё не плодит версию', async () => {
    vi.stubGlobal('fetch', mockFetchOk(2));
    // До транзакции — снимок v1 без версий; под замком строка уже v2 с тем же
    // lastsave: решение принимается по свежему состоянию, объект убирается.
    const h = makeHarness(makeFile(1), []);
    h.mocks.lockForSave.mockResolvedValue({
      file: makeFile(2),
      latest: makeVersionRow(2, `${FILE_ID}.v1`, '2026-09-28T20:00:00.000Z'),
    });
    await h.service.handle(FILE_ID, {
      status: 2,
      key: `${FILE_ID}.v1`,
      url: SAVE_URL,
      lastsave: '2026-09-28T20:00:00.000Z',
    });
    expect(h.mocks.saveVersion).not.toHaveBeenCalled();
    expect(h.mocks.put).toHaveBeenCalledTimes(1);
    expect(h.mocks.remove).toHaveBeenCalledWith([h.mocks.put.mock.calls[0]?.[0]]);
  });

  it('устаревший ключ по свежей строке под замком — подтверждение, объект убран', async () => {
    vi.stubGlobal('fetch', mockFetchOk(2));
    // До транзакции файл v1 (ключ совпадает); пока скачивали, сохранение ушло
    // на v2 под ключом следующей сессии DS: колбэк подтверждаем без версии.
    const h = makeHarness(makeFile(1), []);
    h.mocks.lockForSave.mockResolvedValue({
      file: makeFile(2),
      latest: makeVersionRow(2, `${FILE_ID}.v2`, '2026-09-28T20:05:00.000Z'),
    });
    await h.service.handle(FILE_ID, {
      status: 2,
      key: `${FILE_ID}.v1`,
      url: SAVE_URL,
      lastsave: '2026-09-28T20:00:00.000Z',
    });
    expect(h.mocks.saveVersion).not.toHaveBeenCalled();
    expect(h.mocks.remove).toHaveBeenCalledWith([h.mocks.put.mock.calls[0]?.[0]]);
  });

  it('откат транзакции удаляет загруженный объект (компенсация)', async () => {
    vi.stubGlobal('fetch', mockFetchOk(2));
    const h = makeHarness(makeFile(1));
    h.mocks.saveVersion.mockRejectedValue(new Error('db down'));
    await expect(
      h.service.handle(FILE_ID, {
        status: 2,
        key: `${FILE_ID}.v1`,
        url: SAVE_URL,
        lastsave: '2026-09-28T20:00:00.000Z',
      }),
    ).rejects.toThrow('db down');
    expect(h.mocks.remove).toHaveBeenCalledWith([h.mocks.put.mock.calls[0]?.[0]]);
  });

  it('P2002 при записи версии — «уже сохранено»: подтверждение и уборка объекта', async () => {
    vi.stubGlobal('fetch', mockFetchOk(2));
    const h = makeHarness(makeFile(1));
    h.mocks.saveVersion.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    await expect(
      h.service.handle(FILE_ID, {
        status: 2,
        key: `${FILE_ID}.v1`,
        url: SAVE_URL,
        lastsave: '2026-09-28T20:00:00.000Z',
      }),
    ).resolves.toBeUndefined();
    expect(h.mocks.remove).toHaveBeenCalledWith([h.mocks.put.mock.calls[0]?.[0]]);
    expect(h.mocks.append).not.toHaveBeenCalled();
    expect(h.mocks.enqueuePdf).not.toHaveBeenCalled();
  });

  it('файл удалён между чтением и транзакцией — подтверждение без версии, объект убран', async () => {
    vi.stubGlobal('fetch', mockFetchOk(2));
    const h = makeHarness(makeFile(1));
    h.mocks.lockForSave.mockResolvedValue(null);
    await expect(
      h.service.handle(FILE_ID, {
        status: 2,
        key: `${FILE_ID}.v1`,
        url: SAVE_URL,
        lastsave: '2026-09-28T20:00:00.000Z',
      }),
    ).resolves.toBeUndefined();
    expect(h.mocks.saveVersion).not.toHaveBeenCalled();
    expect(h.mocks.remove).toHaveBeenCalledWith([h.mocks.put.mock.calls[0]?.[0]]);
  });
});
