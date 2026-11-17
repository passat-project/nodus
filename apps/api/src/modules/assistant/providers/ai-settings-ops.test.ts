import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import type { AiSettingsBody } from '@nodus/contracts';

import type { SecretBoxService } from '../../../core/crypto/secret-box.service.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import type { AiSettingsRepository, ProviderRow } from './ai-settings.repository.js';
import { AiSettingsService } from './ai-settings.service.js';

/**
 * Операции настроек провайдеров (#894): чтение, полная замена, каталог
 * моделей, проверка соединения и выбор провайдера для прогона. Провайдер
 * подменён — проверяем решение сервиса, а не HTTP-клиент (он покрыт своим
 * тестом): какие ошибки становятся доменными и что уходит провайдеру.
 */

const providerState = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  listModels: vi.fn(),
  streamChat: vi.fn(),
}));

vi.mock('./openai-compatible.provider.js', () => ({
  OpenAiCompatibleProvider: class {
    constructor(options: Record<string, unknown>) {
      providerState.options = options;
    }
    listModels(): unknown {
      return providerState.listModels();
    }
    streamChat(args: unknown): unknown {
      return providerState.streamChat(args);
    }
  },
}));

const PROVIDER_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = 'deepseek/deepseek-v4.1-flash-1017';

const row: ProviderRow = {
  id: PROVIDER_ID,
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiFormat: 'openai-chat',
  authType: 'bearer',
  apiKeyCiphertext: 'ciphertext',
  apiKeyHint: '1234',
  headers: [{ name: 'HTTP-Referer', value: 'https://nodus.by' }],
  enabled: true,
  models: [{ id: MODEL_ID, enabled: true, tools: true, vision: false }],
  sortOrder: 0,
};

function makeService(
  overrides: {
    providers?: ProviderRow[];
    provider?: ProviderRow | null;
    settings?: {
      defaultProviderId: string | null;
      defaultModelId: string | null;
      instructions: string;
    };
    openResult?: string | null;
  } = {},
) {
  const repo = {
    findProviders: vi.fn(async () => overrides.providers ?? [{ ...row }]),
    findProvider: vi.fn(async () => ('provider' in overrides ? overrides.provider : { ...row })),
    findSettings: vi.fn(
      async () =>
        overrides.settings ?? {
          defaultProviderId: PROVIDER_ID,
          defaultModelId: MODEL_ID,
          instructions: 'Отвечай кратко',
        },
    ),
    replaceAll: vi.fn(async () => undefined),
  } as unknown as AiSettingsRepository;
  const secretBox = {
    seal: (value: string) => `sealed:${value}`,
    hint: (value: string) => value.slice(-4),
    open: () => (overrides.openResult === undefined ? 'sk-live' : overrides.openResult),
  } as unknown as SecretBoxService;
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  return { service: new AiSettingsService(repo, secretBox, logger), repo, logger };
}

function body(overrides: Partial<AiSettingsBody> = {}): AiSettingsBody {
  return {
    providers: [
      {
        id: PROVIDER_ID,
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiFormat: 'openai-chat',
        authType: 'bearer',
        headers: [],
        enabled: true,
        models: row.models as AiSettingsBody['providers'][number]['models'],
      },
    ],
    defaultProviderId: PROVIDER_ID,
    defaultModelId: MODEL_ID,
    instructions: '  Отвечай кратко  ',
    ...overrides,
  };
}

beforeEach(() => {
  providerState.listModels.mockReset();
  providerState.streamChat.mockReset();
  providerState.options = null;
});

describe('AiSettingsService.get: чтение без секретов (#894)', () => {
  it('отдаёт hasKey/keyHint и лимиты, но не шифртекст', async () => {
    const { service } = makeService();
    const settings = await service.get();
    expect(settings.providers[0]).toMatchObject({
      id: PROVIDER_ID,
      name: 'OpenRouter',
      hasKey: true,
      keyHint: '1234',
      headers: [{ name: 'HTTP-Referer', value: 'https://nodus.by' }],
      enabled: true,
      apiFormat: 'openai-chat',
    });
    expect(settings.providers[0]).not.toHaveProperty('apiKeyCiphertext');
    expect(settings.defaultProviderId).toBe(PROVIDER_ID);
    expect(settings.instructions).toBe('Отвечай кратко');
    expect(settings.limits).toBeTruthy();
  });

  it('битые JSONB (headers/models) не роняют чтение — пустые списки', async () => {
    const { service } = makeService({
      providers: [{ ...row, headers: 'не-массив' as never, models: { broken: true } as never }],
    });
    const settings = await service.get();
    expect(settings.providers[0]!.headers).toEqual([]);
    expect(settings.providers[0]!.models).toEqual([]);
  });

  it('x-api-key провайдер и провайдер без ключа читаются честно', async () => {
    const { service } = makeService({
      providers: [{ ...row, authType: 'x-api-key', apiKeyCiphertext: null, apiKeyHint: null }],
    });
    const settings = await service.get();
    expect(settings.providers[0]!.authType).toBe('x-api-key');
    expect(settings.providers[0]!.hasKey).toBe(false);
    expect(settings.providers[0]!.keyHint).toBeNull();
  });
});

describe('AiSettingsService.put: замена настроек (#894)', () => {
  it('новый провайдер без id получает id, ключ шифруется, адрес очищается от слеша', async () => {
    const { service, repo } = makeService({ providers: [] });
    await service.put(
      body({
        providers: [
          {
            name: 'Новый',
            baseUrl: 'https://api.example/v1///',
            apiFormat: 'openai-chat',
            authType: 'x-api-key',
            apiKey: 'sk-new-key',
            headers: [],
            enabled: true,
            models: [],
          },
        ],
        defaultProviderId: null,
        defaultModelId: null,
      }),
    );
    const [providers, settings] = (repo.replaceAll as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [ProviderRow[], Record<string, unknown>];
    expect(providers[0]!.id).toBeTruthy();
    expect(providers[0]!.baseUrl).toBe('https://api.example/v1');
    expect(providers[0]!.apiKeyCiphertext).toBe('sealed:sk-new-key');
    expect(providers[0]!.apiKeyHint).toBe('-key');
    expect(providers[0]!.sortOrder).toBe(0);
    expect(settings).toEqual({
      defaultProviderId: null,
      defaultModelId: null,
      routerProviderId: null,
      routerModelId: null,
      instructions: 'Отвечай кратко',
    });
  });

  it('clearKey удаляет сохранённый ключ, а без ключа — переиспользует прежний', async () => {
    const { service, repo } = makeService();
    await service.put(
      body({
        providers: [
          { ...body().providers[0]!, clearKey: true },
          { ...body().providers[0]!, id: 'other-id' },
        ],
      }),
    );
    const [providers] = (repo.replaceAll as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      ProviderRow[],
    ];
    expect(providers[0]!.apiKeyCiphertext).toBeNull();
    expect(providers[0]!.apiKeyHint).toBeNull();
    // Второй — новый id, прежнего ключа у него нет.
    expect(providers[1]!.apiKeyCiphertext).toBeNull();
  });

  it('одновременные apiKey и clearKey — ошибка валидации', async () => {
    const { service, repo } = makeService();
    await expect(
      service.put(
        body({ providers: [{ ...body().providers[0]!, apiKey: 'sk-x', clearKey: true }] }),
      ),
    ).rejects.toMatchObject({ code: expect.stringContaining('VALIDATION') });
    expect(repo.replaceAll).not.toHaveBeenCalled();
  });

  it('провайдер по умолчанию вне списка — 404, запись не выполняется', async () => {
    const { service, repo } = makeService();
    await expect(
      service.put(body({ defaultProviderId: 'missing-id', defaultModelId: null })),
    ).rejects.toMatchObject({ code: expect.stringContaining('NOT_FOUND') });
    expect(repo.replaceAll).not.toHaveBeenCalled();
  });

  it('модель по умолчанию не принадлежит провайдеру — ошибка валидации с полем', async () => {
    const { service } = makeService();
    try {
      await service.put(body({ defaultModelId: 'чужая-модель' }));
      throw new Error('ожидалась ошибка');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).details).toEqual({ field: 'defaultModelId' });
    }
  });

  it('модель-диспетчер пары сохраняется в настройках (#917)', async () => {
    const { service, repo } = makeService();
    await service.put(body({ routerProviderId: PROVIDER_ID, routerModelId: MODEL_ID }));
    const [, settings] = (repo.replaceAll as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      ProviderRow[],
      Record<string, unknown>,
    ];
    expect(settings).toMatchObject({ routerProviderId: PROVIDER_ID, routerModelId: MODEL_ID });
  });

  it('модель-диспетчер не из выбранного провайдера — ошибка валидации, записи нет (#917)', async () => {
    const { service, repo } = makeService();
    await expect(
      service.put(body({ routerProviderId: PROVIDER_ID, routerModelId: 'чужая-модель' })),
    ).rejects.toMatchObject({ details: { field: 'routerModelId' } });
    expect(repo.replaceAll).not.toHaveBeenCalled();
  });

  it('провайдер-диспетчер вне списка — ошибка валидации (#917)', async () => {
    const { service, repo } = makeService();
    await expect(
      service.put(
        body({ routerProviderId: '22222222-2222-4222-8222-222222222222', routerModelId: MODEL_ID }),
      ),
    ).rejects.toMatchObject({ details: { field: 'routerModelId' } });
    expect(repo.replaceAll).not.toHaveBeenCalled();
  });
});
