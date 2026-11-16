import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  ATTEMPT_KEY,
  FILE_ID,
  SAVE_URL,
  SAVE_URL_MD5,
  makeFile,
  makeHarness,
  makeVersionRow,
  mockFetchOk,
} from './office-callback.test-helpers.js';
import type { OfficeCallbackBody } from './office-callback.service.js';

describe('OfficeCallbackService (#138)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('status 2 без url — подтверждение без версии', async () => {
    const h = makeHarness(makeFile());
    await h.service.handle(FILE_ID, { status: 2, key: `${FILE_ID}.v1` });
    expect(h.mocks.put).not.toHaveBeenCalled();
    expect(h.mocks.saveVersion).not.toHaveBeenCalled();
  });

  it('status 4 — нет изменений, ничего не делает', async () => {
    const h = makeHarness(makeFile());
    await h.service.handle(FILE_ID, { status: 4, key: `${FILE_ID}.v1` });
    expect(h.mocks.put).not.toHaveBeenCalled();
  });

  it('status 6 (forcesave): версия v2, объект в хранилище, событие и аудит в транзакции', async () => {
    const fetchMock = mockFetchOk(2);
    vi.stubGlobal('fetch', fetchMock);
    const h = makeHarness(makeFile(1));
    const body: OfficeCallbackBody = {
      status: 6,
      key: `${FILE_ID}.v1`,
      url: SAVE_URL,
      lastsave: '2026-09-28T20:00:00.000Z',
      forcesavetype: 1,
    };
    await h.service.handle(FILE_ID, body);

    // origin переписан на внутренний адрес DS, путь и подпись сохранены
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ds-internal/cache/files/data/xxx/output.xlsx?expires=999',
    );
    expect(h.mocks.put).toHaveBeenCalledWith(
      expect.stringMatching(ATTEMPT_KEY),
      2,
      expect.any(String),
      expect.anything(),
    );
    expect(h.mocks.lockForSave).toHaveBeenCalledWith(h.tx, FILE_ID);
    expect(h.mocks.saveVersion).toHaveBeenCalledWith(h.tx, {
      fileObjectId: FILE_ID,
      version: 2,
      key: expect.stringMatching(ATTEMPT_KEY),
      size: 2,
      mime: expect.any(String),
      sourceKey: `${FILE_ID}.v1`,
      sourceLastsave: BigInt(Date.parse('2026-09-28T20:00:00.000Z')),
    });
    expect(h.mocks.emit).toHaveBeenCalledWith(
      h.tx,
      'file.version_created',
      { fileId: FILE_ID, version: 2, size: 2, mime: expect.any(String) },
      expect.anything(),
    );
    expect(h.mocks.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'files.office_save', entityId: FILE_ID }),
    );
  });

  it('повторная доставка того же сохранения (тот же lastsave) не плодит версию', async () => {
    const fetchMock = mockFetchOk(2);
    vi.stubGlobal('fetch', fetchMock);
    const h = makeHarness(makeFile(2), [
      makeVersionRow(2, `${FILE_ID}.v1`, '2026-09-28T20:00:00.000Z'),
    ]);
    await h.service.handle(FILE_ID, {
      status: 2,
      key: `${FILE_ID}.v1`,
      url: SAVE_URL,
      lastsave: '2026-09-28T20:00:00.000Z',
    });
    expect(h.mocks.put).not.toHaveBeenCalled();
    expect(h.mocks.saveVersion).not.toHaveBeenCalled();
  });

  it('более поздний lastsave того же ключа — новая версия (реальные изменения)', async () => {
    const fetchMock = mockFetchOk(2);
    vi.stubGlobal('fetch', fetchMock);
    const h = makeHarness(makeFile(2), [
      makeVersionRow(2, `${FILE_ID}.v1`, '2026-09-28T20:00:00.000Z'),
    ]);
    await h.service.handle(FILE_ID, {
      status: 2,
      key: `${FILE_ID}.v1`,
      url: SAVE_URL,
      lastsave: '2026-09-28T20:05:00.000Z',
    });
    expect(h.mocks.saveVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ version: 3 }),
    );
  });

  it('колбэк устаревшего ключа подтверждается без сохранения', async () => {
    const h = makeHarness(makeFile(2));
    await h.service.handle(FILE_ID, { status: 2, key: `${FILE_ID}.v1`, url: SAVE_URL });
    expect(h.mocks.put).not.toHaveBeenCalled();
  });

  it('файл удалён — подтверждение без ошибки (DS завершает сессию)', async () => {
    const h = makeHarness(null);
    await expect(
      h.service.handle(FILE_ID, { status: 2, key: `${FILE_ID}.v1`, url: SAVE_URL }),
    ).resolves.toBeUndefined();
  });

  it('md5-подпись DS расходится с телом — наблюдаемость, версия сохраняется', async () => {
    vi.stubGlobal('fetch', mockFetchOk(2));
    const h = makeHarness(makeFile(1));
    await h.service.handle(FILE_ID, {
      status: 2,
      key: `${FILE_ID}.v1`,
      url: 'https://nodus.by/cache/files/data/xxx/output.xlsx?md5=WRONG&expires=999',
      lastsave: '2026-09-28T20:00:00.000Z',
    });
    expect(h.mocks.saveVersion).toHaveBeenCalledWith(
      h.tx,
      expect.objectContaining({ version: 2, size: 2 }),
    );
  });

  it('md5 совпал — версия сохранена (#182: сверка целостности байтов)', async () => {
    vi.stubGlobal('fetch', mockFetchOk(2));
    const h = makeHarness(makeFile(1));
    await h.service.handle(FILE_ID, {
      status: 6,
      key: `${FILE_ID}.v1`,
      url: SAVE_URL_MD5,
      lastsave: '2026-09-28T20:00:00.000Z',
    });
    expect(h.mocks.saveVersion).toHaveBeenCalledWith(h.tx, expect.objectContaining({ version: 2 }));
  });

  it('нет content-length (chunked) — сохраняет по фактическим байтам', async () => {
    vi.stubGlobal('fetch', mockFetchOk(null));
    const h = makeHarness(makeFile(1));
    await h.service.handle(FILE_ID, {
      status: 6,
      key: `${FILE_ID}.v1`,
      url: SAVE_URL,
      lastsave: '2026-09-28T20:00:00.000Z',
    });
    expect(h.mocks.put).toHaveBeenCalledWith(
      expect.stringMatching(ATTEMPT_KEY),
      2,
      expect.any(String),
      expect.anything(),
    );
    expect(h.mocks.saveVersion).toHaveBeenCalledWith(h.tx, expect.objectContaining({ size: 2 }));
  });

  it('declared ≠ фактических — предупреждение, версия сохраняется', async () => {
    vi.stubGlobal('fetch', mockFetchOk(999));
    const h = makeHarness(makeFile(1));
    await h.service.handle(FILE_ID, {
      status: 6,
      key: `${FILE_ID}.v1`,
      url: SAVE_URL,
      lastsave: '2026-09-28T20:00:00.000Z',
    });
    expect(h.mocks.saveVersion).toHaveBeenCalledWith(h.tx, expect.objectContaining({ size: 2 }));
    // расхождение зафиксировано наблюдаемостью, не фатально
    expect(h.mocks.warnLog).toHaveBeenCalledWith(
      expect.objectContaining({ declared: 999 }),
      expect.stringContaining('content-length'),
    );
  });

  it('тело сверх потолка скачивания — бросок (DS повторит), без put', async () => {
    // Один чанк над потолком (128 МБ): аллокация живёт секунды, память vitest тянет.
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(129 * 1024 * 1024));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        body,
        headers: new Map() as unknown as Headers,
        status: 200,
      })),
    );
    const h = makeHarness(makeFile(1));
    await expect(
      h.service.handle(FILE_ID, {
        status: 6,
        key: `${FILE_ID}.v1`,
        url: SAVE_URL,
        lastsave: '2026-09-28T20:00:00.000Z',
      }),
    ).rejects.toThrow(/cap/i);
    expect(h.mocks.put).not.toHaveBeenCalled();
  });

  it('дубль версии по уникальному ключу (ретрай без lastsave) — дедуп, без ошибки', async () => {
    vi.stubGlobal('fetch', mockFetchOk(2));
    const h = makeHarness(makeFile(1));
    h.mocks.findVersion.mockResolvedValue(
      makeVersionRow(2, `${FILE_ID}.v1`, '2026-09-28T20:00:00.000Z'),
    );
    await h.service.handle(FILE_ID, {
      status: 2,
      key: `${FILE_ID}.v1`,
      url: SAVE_URL,
      // lastsave отсутствует: lastsave-дедуп пропущен, ловит unique-дедуп
    });
    expect(h.mocks.put).not.toHaveBeenCalled();
    expect(h.mocks.saveVersion).not.toHaveBeenCalled();
  });

  describe('SSRF: скачивание только с внутреннего origin DS (fail-closed)', () => {
    it('url колбэка не парсится — VALIDATION_FAILED, fetch не вызывается', async () => {
      const fetchMock = mockFetchOk(2);
      vi.stubGlobal('fetch', fetchMock);
      const h = makeHarness(makeFile(1));
      await expect(
        h.service.handle(FILE_ID, { status: 2, key: `${FILE_ID}.v1`, url: 'not a url' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(h.mocks.put).not.toHaveBeenCalled();
    });

    it('не-http(s) схема (file:) — отказ, fetch не вызывается', async () => {
      const fetchMock = mockFetchOk(2);
      vi.stubGlobal('fetch', fetchMock);
      const h = makeHarness(makeFile(1));
      await expect(
        h.service.handle(FILE_ID, { status: 2, key: `${FILE_ID}.v1`, url: 'file:///etc/passwd' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('кривой OFFICE_INTERNAL_URL — ошибка, а не fetch сырого url', async () => {
      const fetchMock = mockFetchOk(2);
      vi.stubGlobal('fetch', fetchMock);
      const h = makeHarness(makeFile(1), [], { internalUrl: 'ds-internal:80/no-scheme' });
      await expect(
        h.service.handle(FILE_ID, {
          status: 2,
          key: `${FILE_ID}.v1`,
          url: 'http://attacker.example/steal',
        }),
      ).rejects.toThrow(/OFFICE_INTERNAL_URL/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('чужой хост в url колбэка — origin всё равно внутренний DS', async () => {
      const fetchMock = mockFetchOk(2);
      vi.stubGlobal('fetch', fetchMock);
      const h = makeHarness(makeFile(1));
      await h.service.handle(FILE_ID, {
        status: 2,
        key: `${FILE_ID}.v1`,
        url: 'http://169.254.169.254/latest/meta-data?x=1',
      });
      expect(fetchMock).toHaveBeenCalledWith('http://ds-internal/latest/meta-data?x=1');
    });
  });

  describe('verifySender', () => {
    const body: OfficeCallbackBody = { status: 2, key: `${FILE_ID}.v1` };

    it('нет токена вовсе — 401', async () => {
      const h = makeHarness(makeFile());
      await expect(h.service.verifySender(body, undefined)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('мусорный Bearer — 401', async () => {
      const h = makeHarness(makeFile());
      await expect(h.service.verifySender(body, 'Bearer garbage')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('payload.key чужого документа — 401 (токен не привязан к телу)', async () => {
      const h = makeHarness(makeFile());
      const token = await h.tokens.sign({ payload: { key: 'another-file.v1' } });
      await expect(h.service.verifySender(body, `Bearer ${token}`)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('валидный Bearer с тем же ключом — пропускает', async () => {
      const h = makeHarness(makeFile());
      const token = await h.tokens.sign({ payload: { ...body } });
      await expect(h.service.verifySender(body, `Bearer ${token}`)).resolves.toBeUndefined();
    });

    it('токен в теле (body.token) без заголовка — пропускает', async () => {
      const h = makeHarness(makeFile());
      const token = await h.tokens.sign({ payload: { ...body } });
      await expect(h.service.verifySender({ ...body, token }, undefined)).resolves.toBeUndefined();
    });
  });
});
