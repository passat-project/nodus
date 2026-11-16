import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortalSettingsRepository } from './portal-settings.repository.js';

/**
 * Репозиторий настроек портала (#558): единственная точка доступа к
 * `portal_settings`; ключ-значение и upsert без чтения чужих строк.
 */

describe('PortalSettingsRepository', () => {
  const prisma = {
    portalSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
  const repo = new PortalSettingsRepository(prisma as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('get: отсутствие строки — null, найденная — значение и метка', async () => {
    prisma.portalSetting.findUnique.mockResolvedValueOnce(null);
    await expect(repo.get('desktop.fileServers')).resolves.toBeNull();

    const updatedAt = new Date('2026-11-16T10:00:00.000Z');
    prisma.portalSetting.findUnique.mockResolvedValueOnce({ value: { servers: [] }, updatedAt });
    await expect(repo.get('desktop.fileServers')).resolves.toEqual({
      value: { servers: [] },
      updatedAt,
    });
    expect(prisma.portalSetting.findUnique).toHaveBeenCalledWith({
      where: { key: 'desktop.fileServers' },
    });
  });

  it('put: upsert по ключу настройки', async () => {
    const updatedAt = new Date('2026-11-16T10:00:00.000Z');
    prisma.portalSetting.upsert.mockResolvedValue({ value: { servers: [] }, updatedAt });
    await expect(repo.put('desktop.fileServers', { servers: [] })).resolves.toEqual({
      value: { servers: [] },
      updatedAt,
    });
    expect(prisma.portalSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'desktop.fileServers' },
      create: { key: 'desktop.fileServers', value: { servers: [] } },
      update: { value: { servers: [] } },
    });
  });
});
