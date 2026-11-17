import { describe, expect, it } from 'vitest';

import { assistantHeaderSchema, assistantProviderUrlSchema } from './ai-settings.schemas.js';

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
