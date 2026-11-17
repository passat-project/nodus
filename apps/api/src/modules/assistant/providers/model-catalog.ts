import { z } from 'zod';

import type { AssistantModelCatalogItem } from '@nodus/contracts';

/**
 * Нормализация каталога `/models` провайдера (ADR-0044): модели приходят в
 * разных диалектах — OpenAI отдаёт только `id`, OpenRouter добавляет
 * `context_length`, `pricing` (за токен, строками) и `supported_parameters`.
 * Поля необязательны: неизвестное — `null`, а не ошибка (каталог лишь
 * помогает админу выбрать модель; ручной ввод всегда доступен).
 */

const openAiModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  context_length: z.number().optional(),
  context_window: z.number().optional(),
  max_completion_tokens: z.number().optional(),
  max_output_tokens: z.number().optional(),
  top_provider: z.object({ max_completion_tokens: z.number().optional() }).optional(),
  pricing: z
    .object({
      prompt: z.union([z.string(), z.number()]).optional(),
      completion: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
  supported_parameters: z.array(z.string()).optional(),
  architecture: z.object({ input_modalities: z.array(z.string()).optional() }).optional(),
});

const openAiModelsResponseSchema = z.object({
  /** OpenAI/OpenRouter: `{ data: [...] }`; некоторые локальные — `{ models: [...] }`. */
  data: z.array(z.unknown()).optional(),
  models: z.array(z.unknown()).optional(),
});

function positive(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

/** Цена за токен (строка или число) → цена за 1M токенов. */
function perMillion(value: string | number | undefined): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) return null;
  const perM = parsed * 1_000_000;
  // Округление до 4 знаков: у OpenRouter цены вида 0.00000015 → 0.15.
  return Math.round(perM * 10_000) / 10_000;
}

/** Разбор ответа `/models` в плоский каталог; сортировка по id. */
export function normalizeModelCatalog(raw: unknown): AssistantModelCatalogItem[] {
  const parsed = openAiModelsResponseSchema.safeParse(raw);
  if (!parsed.success) return [];
  const list = parsed.data.data ?? parsed.data.models ?? [];
  const models = new Map<string, AssistantModelCatalogItem>();
  for (const item of list) {
    const model = openAiModelSchema.safeParse(item);
    if (!model.success) continue;
    const value = model.data;
    if (models.has(value.id)) continue;
    models.set(value.id, {
      id: value.id,
      label: value.name?.trim() || null,
      contextWindow: positive(value.context_length ?? value.context_window),
      maxOutput: positive(
        value.max_completion_tokens ??
          value.max_output_tokens ??
          value.top_provider?.max_completion_tokens,
      ),
      inputPricePerM: perMillion(value.pricing?.prompt),
      outputPricePerM: perMillion(value.pricing?.completion),
    });
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}
