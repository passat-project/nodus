import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferencesService } from './preferences.service.js';

const USER = '33333333-3333-3333-3333-333333333333';
const OTHER = '44444444-4444-4444-4444-444444444444';

describe('PreferencesService', () => {
  const repo = { get: vi.fn(), put: vi.fn() };
  const service = new PreferencesService(repo as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('нет строки — пустые настройки и метка «никогда»', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.get(USER)).resolves.toEqual({
      preferences: {},
      updatedAt: new Date(0).toISOString(),
    });
  });

  it('читает раскладку и отбрасывает неизвестные поля', async () => {
    repo.get.mockResolvedValue({
      data: {
        navOrder: ['home'],
        cardTabs: { project: { version: 1, groups: [{ tabs: ['structure'] }] } },
        secret: 'не сохраняем',
      },
      updatedAt: new Date('2026-11-11T10:00:00.000Z'),
    });
    const response = await service.get(USER);
    expect(response.preferences.cardTabs?.project?.groups[0]?.tabs).toEqual(['structure']);
    expect('secret' in response.preferences).toBe(false);
    expect(response.updatedAt).toBe('2026-11-11T10:00:00.000Z');
  });

  it('битые данные в БД — пустые настройки, не исключение', async () => {
    repo.get.mockResolvedValue({ data: { cardTabs: 'мусор' }, updatedAt: new Date() });
    await expect(service.get(USER)).resolves.toMatchObject({ preferences: {} });
  });

  it('пишет только от имени переданного пользователя (IDOR-граница)', async () => {
    repo.put.mockResolvedValue({ data: {}, updatedAt: new Date('2026-11-11T10:00:00.000Z') });
    await service.put(USER, { navOrder: ['home'] });
    expect(repo.put).toHaveBeenCalledWith(USER, expect.objectContaining({ navOrder: ['home'] }));
    expect(repo.put).not.toHaveBeenCalledWith(OTHER, expect.anything());
  });

  it('невалидная раскладка отклоняется до записи', async () => {
    await expect(
      service.put(USER, { cardTabs: { project: { version: 1, groups: [] } } } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repo.put).not.toHaveBeenCalled();
  });
});
