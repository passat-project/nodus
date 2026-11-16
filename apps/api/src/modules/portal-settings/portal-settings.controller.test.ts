import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortalSettingsController } from './portal-settings.controller.js';

/**
 * Тонкий контроллер настроек портала (#558): GET отдаёт сервис, PUT
 * передаёт список в сервис как есть (граница/право — гвард и pipe).
 */

describe('PortalSettingsController', () => {
  const service = { getFileServers: vi.fn(), putFileServers: vi.fn() };
  const controller = new PortalSettingsController(service as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET отдаёт список сервиса', async () => {
    const response = { servers: ['\\\\FS01\\Projects'], updatedAt: '2026-11-16T10:00:00.000Z' };
    service.getFileServers.mockResolvedValue(response);
    await expect(controller.getFileServers()).resolves.toBe(response);
  });

  it('PUT передаёт серверы сервису', async () => {
    const response = { servers: [], updatedAt: '2026-11-16T10:00:00.000Z' };
    service.putFileServers.mockResolvedValue(response);
    const body = { servers: ['\\\\FS01\\Projects'] };
    await expect(controller.putFileServers(body)).resolves.toBe(response);
    expect(service.putFileServers).toHaveBeenCalledWith(body.servers);
  });
});
