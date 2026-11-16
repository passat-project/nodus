import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortalSettingsService } from './portal-settings.service.js';

/**
 * «Файловые серверы» (#558): пустой/битый список читается как пустой,
 * запись нормализует `\\server\share`, дубли и мусор отклоняются до БД.
 */

describe('PortalSettingsService: файловые серверы', () => {
  const repo = { get: vi.fn(), put: vi.fn() };
  const service = new PortalSettingsService(repo as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('нет строки — пустой список и метка «никогда»', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.getFileServers()).resolves.toEqual({
      servers: [],
      updatedAt: new Date(0).toISOString(),
    });
  });

  it('читает валидные значения, отбрасывает мусор и дубли', async () => {
    repo.get.mockResolvedValue({
      value: {
        servers: [
          '\\\\FS01\\Projects',
          'https://example.com',
          '\\\\fs01\\projects',
          '\\\\FS02\\Docs\\',
        ],
      },
      updatedAt: new Date('2026-11-16T10:00:00.000Z'),
    });
    await expect(service.getFileServers()).resolves.toEqual({
      servers: ['\\\\FS01\\Projects', '\\\\FS02\\Docs'],
      updatedAt: '2026-11-16T10:00:00.000Z',
    });
  });

  it('битая форма в БД — пустой список, не исключение', async () => {
    repo.get.mockResolvedValue({ value: { servers: 'мусор' }, updatedAt: new Date() });
    await expect(service.getFileServers()).resolves.toMatchObject({ servers: [] });
  });

  it('запись нормализует хвостовой слэш и возвращает сохранённое', async () => {
    repo.put.mockResolvedValue({
      value: { servers: ['\\\\FS01\\Projects'] },
      updatedAt: new Date('2026-11-16T10:00:00.000Z'),
    });
    await service.putFileServers(['  \\\\FS01\\Projects\\  ']);
    expect(repo.put).toHaveBeenCalledWith('desktop.fileServers', {
      servers: ['\\\\FS01\\Projects'],
    });
  });

  it('невалидный сервер, путь глубже папки и дубли отклоняются до записи', async () => {
    for (const servers of [
      ['https://example.com'],
      ['\\\\FS01\\Projects\\folder'],
      ['\\\\FS01\\Projects', '\\\\fs01\\projects'],
    ]) {
      await expect(service.putFileServers(servers)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
    expect(repo.put).not.toHaveBeenCalled();
  });
});
