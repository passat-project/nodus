import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';

import type { SecretBoxService } from '../../../core/crypto/secret-box.service.js';
import type { AiSettingsRepository, ProviderRow } from './ai-settings.repository.js';
import { LlmProviderError } from './llm-provider.port.js';
import { AiSettingsService } from './ai-settings.service.js';

/**
 * Каталог моделей, проверка соединения и выбор провайдера для прогона
 * (#894). Провайдер подменён — проверяем решение сервиса, а не HTTP-клиент:
 * какие ошибки становятся доменными, что уходит провайдеру и как выбирается
 * модель по умолчанию.
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
      routerProviderId?: string | null;
      routerModelId?: string | null;
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
          routerProviderId: null,
          routerModelId: null,
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

beforeEach(() => {
  providerState.listModels.mockReset();
  providerState.streamChat.mockReset();
  providerState.options = null;
});

describe('AiSettingsService.listModels / test (#894)', () => {
  it('неизвестный провайдер — доменный 404', async () => {
    const { service } = makeService({ provider: null });
    await expect(service.listModels(PROVIDER_ID)).rejects.toMatchObject({
      code: expect.stringContaining('NOT_FOUND'),
    });
  });

  it('каталог моделей отдаётся как есть; сбой провайдера — ASSISTANT_PROVIDER_UNAVAILABLE', async () => {
    const { service } = makeService();
    providerState.listModels.mockResolvedValueOnce([
      { id: 'm1', enabled: true, tools: true, vision: false },
    ]);
    await expect(service.listModels(PROVIDER_ID)).resolves.toMatchObject({
      models: [{ id: 'm1' }],
    });

    providerState.listModels.mockRejectedValueOnce(new LlmProviderError('provider_error', '401'));
    await expect(service.listModels(PROVIDER_ID)).rejects.toMatchObject({
      code: expect.stringContaining('PROVIDER_UNAVAILABLE'),
      message: '401',
    });
  });

  it('test(): включённая модель из настроек, короткий поток, sample ≤ 200', async () => {
    const { service } = makeService();
    providerState.streamChat.mockImplementation(async function* () {
      yield { type: 'text.delta', text: 'работает' };
      yield { type: 'text.delta', text: ' '.repeat(200) };
      yield { type: 'text.delta', text: 'ещё' };
    });
    const result = await service.test(PROVIDER_ID);
    expect(result.ok).toBe(true);
    expect(result.model).toBe(MODEL_ID);
    expect(result.errorCode).toBeNull();
    expect(result.sample?.length).toBeLessThanOrEqual(200);
    expect(providerState.options).toMatchObject({
      baseUrl: 'https://openrouter.ai/api/v1',
      authType: 'bearer',
      apiKey: 'sk-live',
    });
  });

  it('test(): моделей нет — берёт каталог; пустой каталог — понятный отказ', async () => {
    const { service } = makeService({
      providers: [{ ...row, models: [] }],
      provider: { ...row, models: [] },
    });
    providerState.listModels.mockResolvedValueOnce([
      { id: 'cat-model', enabled: true, tools: false, vision: false },
    ]);
    providerState.streamChat.mockImplementation(async function* () {
      yield { type: 'text.delta', text: 'ок' };
    });
    expect((await service.test(PROVIDER_ID)).model).toBe('cat-model');

    providerState.listModels.mockResolvedValueOnce([]);
    const empty = await service.test(PROVIDER_ID);
    expect(empty).toMatchObject({ ok: false, errorCode: 'provider_error', model: null });
  });

  it('test(): сбой провайдера — ok:false с кодом, а не исключение', async () => {
    const { service } = makeService();
    providerState.streamChat.mockImplementation(async function* () {
      yield { type: 'text.delta', text: '' };
      throw new LlmProviderError('provider_unavailable', 'Сеть недоступна');
    });
    const result = await service.test(PROVIDER_ID);
    expect(result).toMatchObject({
      ok: false,
      errorCode: 'provider_unavailable',
      errorMessage: 'Сеть недоступна',
      sample: null,
    });
  });

  it('неизвестный провайдер в test() — доменный 404', async () => {
    const { service } = makeService({ provider: null });
    await expect(service.test(PROVIDER_ID)).rejects.toMatchObject({
      code: expect.stringContaining('NOT_FOUND'),
    });
  });
});

describe('AiSettingsService.resolveForRun: выбор провайдера (#894)', () => {
  it('берёт провайдера и модель по умолчанию с инструкциями', async () => {
    const { service } = makeService();
    const resolved = await service.resolveForRun();
    expect(resolved).toMatchObject({
      providerId: PROVIDER_ID,
      providerName: 'OpenRouter',
      modelId: MODEL_ID,
      instructions: 'Отвечай кратко',
    });
    expect(resolved.model.id).toBe(MODEL_ID);
    expect(resolved.provider).toBeTruthy();
  });

  it('дефолт недоступен — первый включённый провайдер и модель с инструментами', async () => {
    const { service } = makeService({
      providers: [
        { ...row, id: 'disabled', enabled: false },
        {
          ...row,
          id: 'second',
          models: [
            { id: 'no-tools', enabled: true, tools: false, vision: false },
            { id: 'with-tools', enabled: true, tools: true, vision: false },
          ],
        },
      ],
      settings: { defaultProviderId: 'missing', defaultModelId: null, instructions: '' },
    });
    const resolved = await service.resolveForRun();
    expect(resolved.providerId).toBe('second');
    expect(resolved.modelId).toBe('with-tools');
  });

  it('без провайдеров — ASSISTANT_PROVIDER_NOT_CONFIGURED', async () => {
    const { service } = makeService({ providers: [] });
    await expect(service.resolveForRun()).rejects.toMatchObject({
      code: expect.stringContaining('NOT_CONFIGURED'),
    });
  });

  it('у провайдера нет включённых моделей — NOT_CONFIGURED с providerId', async () => {
    const { service } = makeService({
      providers: [{ ...row, models: [{ id: 'off', enabled: false, tools: true, vision: false }] }],
      settings: { defaultProviderId: null, defaultModelId: null, instructions: '' },
    });
    await expect(service.resolveForRun()).rejects.toMatchObject({
      code: expect.stringContaining('NOT_CONFIGURED'),
      details: { providerId: PROVIDER_ID },
    });
  });

  it('нерасшифровываемый ключ — предупреждение в лог, провайдер без ключа', async () => {
    const { service, logger } = makeService({ openResult: null });
    const resolved = await service.resolveForRun();
    expect(resolved.provider).toBeTruthy();
    expect(logger.warn).toHaveBeenCalled();
    expect(providerState.options).toMatchObject({ apiKey: null });
  });
});

describe('AiSettingsService.resolveRouter: модель-диспетчер (#917)', () => {
  it('не настроена — null, прогон идёт по горячей полке', async () => {
    const { service } = makeService();
    await expect(service.resolveRouter()).resolves.toBeNull();
  });

  it('выключенный провайдер или чужая модель — null, без исключения', async () => {
    const disabled = makeService({
      providers: [{ ...row, enabled: false }],
      settings: {
        defaultProviderId: null,
        defaultModelId: null,
        routerProviderId: PROVIDER_ID,
        routerModelId: MODEL_ID,
        instructions: '',
      },
    });
    await expect(disabled.service.resolveRouter()).resolves.toBeNull();

    const missingModel = makeService({
      settings: {
        defaultProviderId: null,
        defaultModelId: null,
        routerProviderId: PROVIDER_ID,
        routerModelId: 'выключенная-модель',
        instructions: '',
      },
    });
    await expect(missingModel.service.resolveRouter()).resolves.toBeNull();
  });

  it('настроенная пара отдаёт провайдера с ключом', async () => {
    const { service } = makeService({
      settings: {
        defaultProviderId: null,
        defaultModelId: null,
        routerProviderId: PROVIDER_ID,
        routerModelId: MODEL_ID,
        instructions: '',
      },
    });
    const router = await service.resolveRouter();
    expect(router).toMatchObject({ providerId: PROVIDER_ID, modelId: MODEL_ID });
    expect(router?.provider).toBeTruthy();
    expect(providerState.options).toMatchObject({ apiKey: 'sk-live' });
  });
});
