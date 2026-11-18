import type { AssistantModel } from '@nodus/contracts';

import type { ProviderDraft } from './ai-provider-columns.js';

/** Общие фикстуры окна провайдера: модель и сохранённый провайдер. */
export function model(overrides: Partial<AssistantModel> = {}): AssistantModel {
  return { id: 'm-1', tools: true, vision: false, enabled: true, ...overrides };
}

export function provider(overrides: Partial<ProviderDraft> = {}): ProviderDraft {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiFormat: 'openai-chat',
    authType: 'bearer',
    headers: [],
    enabled: true,
    models: [model()],
    persisted: true,
    hasKey: false,
    keyHint: null,
    ...overrides,
  };
}
