import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FILE_ID,
  SAVE_URL,
  makeFile,
  makeHarness,
  mockFetchOk,
} from './office-callback.test-helpers.js';

/**
 * #356: вторая линия после команды drop — колбэк сохранения не создаёт
 * версию, если в документ правили только уволенные. Источник состава —
 * реестр сессий, а не `body.users` (для status 2/6 это последний редактор).
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OfficeCallbackService: редакторы-уволенные (#356)', () => {
  it('в реестре только уволенный — версия не создаётся', async () => {
    const h = makeHarness(makeFile());
    const dead = '00000000-0000-0000-0000-000000000042';
    h.mocks.editorsOf.mockResolvedValueOnce([dead]);
    h.mocks.filterActiveUserIds.mockResolvedValueOnce([]);

    await h.service.handle(FILE_ID, {
      status: 2,
      key: `${FILE_ID}.v1`,
      url: SAVE_URL,
    });

    expect(h.mocks.filterActiveUserIds).toHaveBeenCalledWith([dead]);
    expect(h.mocks.put).not.toHaveBeenCalled();
    expect(h.mocks.saveVersion).not.toHaveBeenCalled();
    expect(h.mocks.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'files.office_save_rejected',
        entityId: FILE_ID,
        details: expect.objectContaining({ reason: 'editors_deactivated' }),
      }),
    );
  });

  it('в реестре есть активный соавтор — сохранение проходит', async () => {
    vi.stubGlobal('fetch', mockFetchOk(2));
    const h = makeHarness(makeFile());
    const dead = '00000000-0000-0000-0000-000000000042';
    const alive = '00000000-0000-0000-0000-000000000043';
    h.mocks.editorsOf.mockResolvedValueOnce([dead, alive]);
    h.mocks.filterActiveUserIds.mockResolvedValueOnce([alive]);

    await h.service.handle(FILE_ID, {
      status: 6,
      key: `${FILE_ID}.v1`,
      url: SAVE_URL,
    });

    expect(h.mocks.saveVersion).toHaveBeenCalledTimes(1);
  });

  it('реестр недоступен — fail-open, сохранение проходит', async () => {
    vi.stubGlobal('fetch', mockFetchOk(2));
    const h = makeHarness(makeFile());
    h.mocks.editorsOf.mockRejectedValueOnce(new Error('redis down'));

    await h.service.handle(FILE_ID, {
      status: 6,
      key: `${FILE_ID}.v1`,
      url: SAVE_URL,
    });

    expect(h.mocks.filterActiveUserIds).not.toHaveBeenCalled();
    expect(h.mocks.saveVersion).toHaveBeenCalledTimes(1);
  });
});
