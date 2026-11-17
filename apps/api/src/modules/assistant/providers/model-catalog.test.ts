import { describe, expect, it } from 'vitest';

import { normalizeModelCatalog } from './model-catalog.js';

/**
 * Нормализация каталога моделей (ADR-0044): OpenAI-диалект, диалект OpenRouter
 * (контекст, цены за токен, supported_parameters) и защита от мусора.
 */

describe('normalizeModelCatalog', () => {
  it('нормализует каталог OpenRouter: контекст, максимум вывода, цены за 1M', () => {
    const models = normalizeModelCatalog({
      data: [
        {
          id: 'deepseek/deepseek-v4.1-flash',
          name: 'DeepSeek V4.1 Flash',
          context_length: 128_000,
          top_provider: { max_completion_tokens: 8_192 },
          pricing: { prompt: '0.00000015', completion: '0.0000006' },
          supported_parameters: ['tools'],
        },
      ],
    });
    expect(models).toEqual([
      {
        id: 'deepseek/deepseek-v4.1-flash',
        label: 'DeepSeek V4.1 Flash',
        contextWindow: 128_000,
        maxOutput: 8_192,
        inputPricePerM: 0.15,
        outputPricePerM: 0.6,
      },
    ]);
  });

  it('минимальный ответ OpenAI (`{ data: [{ id }] }`) — остальное null', () => {
    const models = normalizeModelCatalog({ data: [{ id: 'gpt-4.1-mini' }] });
    expect(models).toEqual([
      {
        id: 'gpt-4.1-mini',
        label: null,
        contextWindow: null,
        maxOutput: null,
        inputPricePerM: null,
        outputPricePerM: null,
      },
    ]);
  });

  it('понимает диалект `{ models: [...] }` локальных серверов', () => {
    const models = normalizeModelCatalog({ models: [{ id: 'qwen3:32b' }] });
    expect(models.map((model) => model.id)).toEqual(['qwen3:32b']);
  });

  it('сортирует по id, убирает дубли и мусор', () => {
    const models = normalizeModelCatalog({
      data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }, { nope: true }, 'text', null],
    });
    expect(models.map((model) => model.id)).toEqual(['a', 'b']);
  });

  it('нечисловые цены и отрицательные значения — null, а не NaN', () => {
    const [model] = normalizeModelCatalog({
      data: [{ id: 'x', pricing: { prompt: 'free', completion: -1 } }],
    });
    expect(model?.inputPricePerM).toBeNull();
    expect(model?.outputPricePerM).toBeNull();
  });

  it('полностью неверный ответ — пустой список (портал не падает)', () => {
    expect(normalizeModelCatalog(null)).toEqual([]);
    expect(normalizeModelCatalog({ data: 'oops' })).toEqual([]);
  });
});
