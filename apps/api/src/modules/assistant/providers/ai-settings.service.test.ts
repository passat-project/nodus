import { describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import type { AiSettingsBody } from '@nodus/contracts';

import type { SecretBoxService } from '../../../core/crypto/secret-box.service.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import type { AiSettingsRepository, ProviderRow } from './ai-settings.repository.js';
import { AiSettingsService } from './ai-settings.service.js';

/**
 * Ключ провайдера не уходит на другой хост: смена origin адреса требует
 * ввести ключ заново (защита в глубину, находка security-ревью 17.11.2026).
 */
const storedProvider: ProviderRow = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiFormat: 'openai-chat',
  authType: 'bearer',
  apiKeyCiphertext: 'ciphertext',
  apiKeyHint: '1234',
  headers: [],
  enabled: true,
  models: [{ id: 'deepseek/deepseek-v4.1-flash-1017', enabled: true, tools: true, vision: false }],
  sortOrder: 0,
};

function body(
  baseUrl: string,
  extra: { apiKey?: string; clearKey?: boolean } = {},
): AiSettingsBody {
  return {
    providers: [
      {
        id: storedProvider.id,
        name: storedProvider.name,
        baseUrl,
        apiFormat: 'openai-chat',
        authType: 'bearer',
        headers: [],
        enabled: true,
        models: storedProvider.models as AiSettingsBody['providers'][number]['models'],
        ...extra,
      },
    ],
    defaultProviderId: storedProvider.id,
    defaultModelId: 'deepseek/deepseek-v4.1-flash-1017',
    instructions: '',
  };
}

function makeService() {
  const repo = {
    findProviders: vi.fn(async () => [{ ...storedProvider }]),
    replaceAll: vi.fn(async () => undefined),
    findProvider: vi.fn(async () => ({ ...storedProvider })),
    findSettings: vi.fn(async () => ({
      defaultProviderId: storedProvider.id,
      defaultModelId: 'deepseek/deepseek-v4.1-flash-1017',
      instructions: '',
    })),
  } as unknown as AiSettingsRepository;
  const secretBox = {
    seal: (value: string) => `sealed:${value}`,
    hint: (value: string) => value.slice(-4),
    open: () => 'sk-live',
  } as unknown as SecretBoxService;
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  return { service: new AiSettingsService(repo, secretBox, logger), repo };
}

describe('AiSettingsService.put: сохранённый ключ и смена адреса', () => {
  it('тот же хост — ключ переиспользуется без повторного ввода', async () => {
    const { service, repo } = makeService();
    await service.put(body('https://openrouter.ai/api/v1/nested'));
    expect(repo.replaceAll).toHaveBeenCalledOnce();
  });

  it('другой хост без нового ключа — понятная ошибка, запись не выполняется', async () => {
    const { service, repo } = makeService();
    await expect(service.put(body('https://evil.example/v1'))).rejects.toBeInstanceOf(
      DomainException,
    );
    expect(repo.replaceAll).not.toHaveBeenCalled();
  });

  it('новый ключ при смене хоста — сохранение проходит', async () => {
    const { service, repo } = makeService();
    await service.put(body('https://evil.example/v1', { apiKey: 'sk-new-key' }));
    expect(repo.replaceAll).toHaveBeenCalledOnce();
  });

  it('явное удаление ключа при смене хоста тоже допустимо', async () => {
    const { service, repo } = makeService();
    await service.put(body('https://another.example/v1', { clearKey: true }));
    expect(repo.replaceAll).toHaveBeenCalledOnce();
  });
});
