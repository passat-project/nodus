import { describe, expect, it } from 'vitest';

import {
  aiSettingsBodySchema,
  assistantHeaderSchema,
  assistantProviderUrlSchema,
} from './ai-settings.schemas.js';

const PROVIDER_ID = '11111111-1111-4111-8111-111111111111';

function body(overrides: Record<string, unknown> = {}) {
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
        models: [],
      },
    ],
    defaultProviderId: null,
    defaultModelId: null,
    instructions: '',
    ...overrides,
  };
}

describe('aiSettingsBodySchema: модель-диспетчер (#917)', () => {
  it('пара провайдер+модель из списка проходит; без пары — тоже', () => {
    expect(
      aiSettingsBodySchema.safeParse(
        body({ routerProviderId: PROVIDER_ID, routerModelId: 'deepseek-flash' }),
      ).success,
    ).toBe(true);
    expect(aiSettingsBodySchema.safeParse(body()).success).toBe(true);
  });

  it('половина пары отклоняется с подсказкой поля', () => {
    const parsed = aiSettingsBodySchema.safeParse(body({ routerProviderId: PROVIDER_ID }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['routerModelId']);
      expect(parsed.error.issues[0]?.message).toMatch(/парой/);
    }
  });

  it('провайдер-диспетчер вне списка отклоняется', () => {
    const parsed = aiSettingsBodySchema.safeParse(
      body({
        routerProviderId: '22222222-2222-4222-8222-222222222222',
        routerModelId: 'deepseek-flash',
      }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['routerProviderId']);
    }
  });
});

describe('assistantHeaderSchema: учётные данные не живут в «дополнительных заголовках»', () => {
  it('обычные заголовки проходят (HTTP-Referer для OpenRouter)', () => {
    expect(
      assistantHeaderSchema.safeParse({ name: 'HTTP-Referer', value: 'https://nodus.by' }).success,
    ).toBe(true);
    expect(assistantHeaderSchema.safeParse({ name: 'X-Title', value: 'Nodus' }).success).toBe(true);
  });

  it.each(['Authorization', 'x-api-key', 'Cookie', 'Proxy-Authorization', 'X-Auth-Token'])(
    'секретный заголовок %s отклоняется с понятной подсказкой',
    (name) => {
      const parsed = assistantHeaderSchema.safeParse({ name, value: 'Bearer sk-secret' });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toMatch(/полем «Ключ»/);
      }
    },
  );
});

describe('assistantProviderUrlSchema: адрес провайдера', () => {
  it('http(s) без логина и параметров принимается', () => {
    expect(assistantProviderUrlSchema.safeParse('https://openrouter.ai/api/v1').success).toBe(true);
    expect(assistantProviderUrlSchema.safeParse('http://localhost:11434/v1').success).toBe(true);
  });

  it('логин, пароль и query отклоняются (секрет не должен уехать в URL)', () => {
    expect(assistantProviderUrlSchema.safeParse('https://user:pass@api.example/v1').success).toBe(
      false,
    );
    expect(assistantProviderUrlSchema.safeParse('https://api.example/v1?key=secret').success).toBe(
      false,
    );
  });
});
