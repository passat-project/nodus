import type { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import {
  assistantHeaderSchema,
  assistantModelSchema,
  type AssistantModel,
  type AssistantProvider,
} from '@nodus/contracts';

import type { SecretBoxService } from '../../../core/crypto/secret-box.service.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import type { ProviderRow } from './ai-settings.repository.js';
import { LlmProviderError, type LlmProvider } from './llm-provider.port.js';
import { OpenAiCompatibleProvider } from './openai-compatible.provider.js';

/**
 * Сборка провайдера и DTO настроек (ADR-0044): JSONB-колонки, расшифровка
 * ключа и единый маппинг сбоев. Вынесено из `ai-settings.service.ts` (I5):
 * сервис отвечает за сценарии, а форма строки и клиент — здесь.
 */

const headersSchema = z.array(assistantHeaderSchema);
const modelsSchema = z.array(assistantModelSchema);

/** JSONB-колонки: битое значение = пустой список (портал не падает). */
export function parseHeaders(raw: unknown): { name: string; value: string }[] {
  const parsed = headersSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export function parseModels(raw: unknown): AssistantModel[] {
  const parsed = modelsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** DTO провайдера без секретов: только `hasKey` и хвост ключа. */
export function toProviderDto(row: ProviderRow): AssistantProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    apiFormat: 'openai-chat',
    authType: row.authType === 'x-api-key' ? 'x-api-key' : 'bearer',
    hasKey: Boolean(row.apiKeyCiphertext),
    keyHint: row.apiKeyHint,
    headers: parseHeaders(row.headers),
    enabled: row.enabled,
    models: parseModels(row.models),
  };
}

/** Клиент провайдера с расшифрованным ключом (ключ живёт только здесь). */
export function providerForRow(
  row: ProviderRow,
  deps: { secretBox: SecretBoxService; logger: PinoLogger },
): LlmProvider {
  const apiKey = row.apiKeyCiphertext ? deps.secretBox.open(row.apiKeyCiphertext) : null;
  if (row.apiKeyCiphertext && apiKey === null) {
    // Ключ сохранён, но не расшифровывается (сменился материал шифрования):
    // честная ошибка вместо тихого 401 от провайдера.
    deps.logger.warn({ providerId: row.id }, 'Provider api key cannot be decrypted');
  }
  return new OpenAiCompatibleProvider({
    baseUrl: row.baseUrl,
    authType: row.authType === 'x-api-key' ? 'x-api-key' : 'bearer',
    apiKey,
    headers: parseHeaders(row.headers),
  });
}

/** Единый маппинг сбоев провайдера: доменная ошибка 502 для API-маршрутов. */
export function providerFailure(
  error: unknown,
  fallback: string,
  logger: PinoLogger,
): LlmProviderError {
  if (error instanceof LlmProviderError) return error;
  if (error instanceof DomainException) {
    return new LlmProviderError('provider_error', error.message);
  }
  logger.warn({ err: error }, 'Provider request failed');
  return new LlmProviderError('provider_unavailable', fallback);
}
