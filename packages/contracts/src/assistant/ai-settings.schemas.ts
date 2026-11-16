import { z } from 'zod';

import { ASSISTANT_LIMITS } from './assistant-limits.js';

/**
 * Настройки ИИ-агента в «Настройках портала» (эпик #889, ADR-0044):
 * провайдеры OpenAI-совместимого формата, их модели, дефолт и правила
 * ассистента.
 *
 * Безопасность: ключ провайдера пишется только на запись — наружу уходит
 * `hasKey` и хвост (`keyHint`). Ключи шифруются на сервере (core/crypto);
 * в контрактах их нет ни в одном ответе.
 */

/** Формат API провайдера: пока единственный — Chat Completions. */
export const assistantApiFormatSchema = z.enum(['openai-chat']);
export type AssistantApiFormat = z.infer<typeof assistantApiFormatSchema>;

/** Как провайдер ждёт ключ: `Authorization: Bearer` или `x-api-key`. */
export const assistantAuthTypeSchema = z.enum(['bearer', 'x-api-key']);
export type AssistantAuthType = z.infer<typeof assistantAuthTypeSchema>;

/**
 * URL провайдера: только http/https, без userinfo и без query. Локальные
 * адреса разрешены (Ollama/vLLM на своём хосте) — настройка доступна только
 * администратору портала.
 */
export const assistantProviderUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.username === '' &&
        url.password === '' &&
        url.search === ''
      );
    } catch {
      return false;
    }
  }, 'Нужен адрес http(s) без логина, пароля и параметров');

/** Модель провайдера: id + подпись и возможности для выбора и подсказок. */
export const assistantModelSchema = z.object({
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().max(200).optional(),
  contextWindow: z.number().int().positive().max(10_000_000).optional(),
  maxOutput: z.number().int().positive().max(1_000_000).optional(),
  /** Поддерживает ли вызов инструментов: без этого ассистент не работает. */
  tools: z.boolean().default(true),
  vision: z.boolean().default(false),
  /** Цены за 1M токенов — только для видимости расходов (квот нет). */
  inputPricePerM: z.number().nonnegative().optional(),
  outputPricePerM: z.number().nonnegative().optional(),
  enabled: z.boolean().default(true),
  /** Дополнительные параметры запроса (reasoning, max_completion_tokens…). */
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type AssistantModel = z.infer<typeof assistantModelSchema>;

/** Дополнительный заголовок провайдера (например, HTTP-Referer для OpenRouter). */
export const assistantHeaderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'Недопустимое имя заголовка'),
  value: z.string().trim().max(500),
});
export type AssistantHeader = z.infer<typeof assistantHeaderSchema>;

/** Провайдер в ответе GET — без ключа: только признак и хвост. */
export const assistantProviderSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  baseUrl: z.string().min(1),
  apiFormat: assistantApiFormatSchema,
  authType: assistantAuthTypeSchema,
  hasKey: z.boolean(),
  keyHint: z.string().nullable(),
  headers: z.array(assistantHeaderSchema),
  enabled: z.boolean(),
  models: z.array(assistantModelSchema),
});
export type AssistantProvider = z.infer<typeof assistantProviderSchema>;

/** Провайдер в PUT: `apiKey` пишется только если передан, `clearKey` — удаляет. */
export const assistantProviderInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(100),
  baseUrl: assistantProviderUrlSchema,
  apiFormat: assistantApiFormatSchema.default('openai-chat'),
  authType: assistantAuthTypeSchema.default('bearer'),
  apiKey: z.string().trim().min(1).max(500).optional(),
  clearKey: z.boolean().optional(),
  headers: z.array(assistantHeaderSchema).max(10).default([]),
  enabled: z.boolean().default(true),
  models: z.array(assistantModelSchema).max(200).default([]),
});
export type AssistantProviderInput = z.infer<typeof assistantProviderInputSchema>;

/** Тело PUT: полная замена набора провайдеров + дефолт + правила. */
export const aiSettingsBodySchema = z
  .object({
    providers: z.array(assistantProviderInputSchema).max(20),
    defaultProviderId: z.uuid().nullable(),
    defaultModelId: z.string().trim().min(1).max(200).nullable(),
    /** Дополнительные правила ассистента — попадают в системный промпт. */
    instructions: z.string().max(4_000),
  })
  .refine(
    (value) =>
      value.defaultProviderId === null ||
      value.providers.some((provider) => provider.id === value.defaultProviderId),
    { message: 'Дефолтный провайдер должен быть в списке', path: ['defaultProviderId'] },
  );
export type AiSettingsBody = z.infer<typeof aiSettingsBodySchema>;

/** Ответ GET/PUT: провайдеры без ключей + дефолт + технические лимиты. */
export const aiSettingsResponseSchema = z.object({
  providers: z.array(assistantProviderSchema),
  defaultProviderId: z.uuid().nullable(),
  defaultModelId: z.string().nullable(),
  instructions: z.string(),
  limits: z.object({
    maxSteps: z.number().int(),
    maxRunSeconds: z.number().int(),
    maxToolResultChars: z.number().int(),
  }),
});
export type AiSettingsResponse = z.infer<typeof aiSettingsResponseSchema>;

/** Модель из каталога провайдера (`GET /models`), нормализованная. */
export const assistantModelCatalogItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().nullable(),
  contextWindow: z.number().int().positive().nullable(),
  maxOutput: z.number().int().positive().nullable(),
  inputPricePerM: z.number().nonnegative().nullable(),
  outputPricePerM: z.number().nonnegative().nullable(),
});
export type AssistantModelCatalogItem = z.infer<typeof assistantModelCatalogItemSchema>;

export const assistantModelCatalogResponseSchema = z.object({
  models: z.array(assistantModelCatalogItemSchema),
});
export type AssistantModelCatalogResponse = z.infer<typeof assistantModelCatalogResponseSchema>;

/** Проверка соединения: успех/провал — данными, а не HTTP-ошибкой. */
export const assistantProviderTestResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  /** Модель, которой отвечали (первая включённая или дефолтная). */
  model: z.string().nullable(),
  /** Безопасный фрагмент ответа (обрезан) — доказательство, что модель жива. */
  sample: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type AssistantProviderTestResponse = z.infer<typeof assistantProviderTestResponseSchema>;

/** Готовые пресеты «Добавить провайдера» (не хардкод списка моделей — URL). */
export const ASSISTANT_PROVIDER_PRESETS = [
  {
    key: 'opencode-go',
    name: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    authType: 'bearer',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    authType: 'bearer',
  },
  {
    key: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    authType: 'bearer',
  },
  {
    key: 'local',
    name: 'Локальная модель (Ollama / vLLM)',
    baseUrl: 'http://localhost:11434/v1',
    authType: 'bearer',
  },
] as const;

/** Технические лимиты в ответе настроек (без квот — только защита). */
export const AI_SETTINGS_LIMITS = {
  maxSteps: ASSISTANT_LIMITS.maxSteps,
  maxRunSeconds: ASSISTANT_LIMITS.maxRunSeconds,
  maxToolResultChars: ASSISTANT_LIMITS.maxToolResultChars,
} as const;
