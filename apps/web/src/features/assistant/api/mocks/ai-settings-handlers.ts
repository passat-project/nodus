import { HttpResponse, http } from 'msw';
import {
  ErrorCode,
  Permission,
  type AiSettingsBody,
  type AiSettingsResponse,
} from '@nodus/contracts';

import { useAuthStore } from '../../../../shared/auth-store.js';

/**
 * Мок «Настройки портала → ИИ-агент» (#894): провайдеры в памяти воркера,
 * ключ хранится только хвостом (как на сервере), запись — с правом
 * `portal.settings.manage` (I8). Проверка соединения всегда успешна:
 * демо-режим без реальной сети.
 */

let settings: AiSettingsResponse = {
  providers: [],
  defaultProviderId: null,
  defaultModelId: null,
  instructions: '',
  limits: { maxSteps: 12, maxRunSeconds: 120, maxToolResultChars: 16_000 },
};

function canManage(): boolean {
  return Boolean(
    useAuthStore.getState().user?.permissions.includes(Permission.PORTAL_SETTINGS_MANAGE),
  );
}

function forbidden() {
  return HttpResponse.json({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' }, { status: 403 });
}

function notFound() {
  return HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'Not found' }, { status: 404 });
}

export const aiSettingsHandlers = [
  http.get('/api/v1/settings/ai', () => {
    if (!canManage()) return forbidden();
    return HttpResponse.json(settings);
  }),

  http.put('/api/v1/settings/ai', async ({ request }) => {
    if (!canManage()) return forbidden();
    const body = (await request.json().catch(() => null)) as AiSettingsBody | null;
    if (!body) {
      return HttpResponse.json(
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
        { status: 400 },
      );
    }
    const providers = body.providers.map((provider, index) => {
      const previous = settings.providers[index];
      return {
        id: provider.id ?? crypto.randomUUID(),
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiFormat: provider.apiFormat,
        authType: provider.authType,
        hasKey: Boolean(provider.apiKey) || Boolean(previous?.hasKey),
        keyHint: provider.apiKey ? provider.apiKey.slice(-4) : (previous?.keyHint ?? null),
        headers: provider.headers,
        enabled: provider.enabled,
        models: provider.models,
      };
    });
    const defaultProvider = providers.find((item) => item.id === body.defaultProviderId);
    settings = {
      providers,
      defaultProviderId: defaultProvider?.id ?? null,
      defaultModelId: defaultProvider ? body.defaultModelId : null,
      instructions: body.instructions,
      limits: settings.limits,
    };
    return HttpResponse.json(settings);
  }),

  http.get('/api/v1/settings/ai/providers/:id/models', ({ params }) => {
    if (!canManage()) return forbidden();
    const provider = settings.providers.find((item) => item.id === params.id);
    if (!provider) return notFound();
    return HttpResponse.json({
      models: [
        {
          id: 'demo/model-flash',
          label: 'Demo Flash',
          contextWindow: 128_000,
          maxOutput: 8_192,
          inputPricePerM: 0.15,
          outputPricePerM: 0.6,
        },
        {
          id: 'demo/model-pro',
          label: 'Demo Pro',
          contextWindow: 200_000,
          maxOutput: 16_384,
          inputPricePerM: 1.2,
          outputPricePerM: 4.8,
        },
      ],
    });
  }),

  http.post('/api/v1/settings/ai/providers/:id/test', ({ params }) => {
    if (!canManage()) return forbidden();
    const provider = settings.providers.find((item) => item.id === params.id);
    if (!provider) return notFound();
    return HttpResponse.json({
      ok: true,
      latencyMs: 412,
      model: provider.models.find((model) => model.enabled)?.id ?? 'demo/model-flash',
      sample: 'работает',
      errorCode: null,
      errorMessage: null,
    });
  }),
];
