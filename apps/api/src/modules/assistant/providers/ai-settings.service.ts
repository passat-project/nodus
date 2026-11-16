import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import {
  AI_SETTINGS_LIMITS,
  assistantHeaderSchema,
  assistantModelSchema,
  ErrorCode,
  type AiSettingsBody,
  type AiSettingsResponse,
  type AssistantModel,
  type AssistantModelCatalogResponse,
  type AssistantProvider,
  type AssistantProviderTestResponse,
} from '@nodus/contracts';

import { SecretBoxService } from '../../../core/crypto/secret-box.service.js';
import { DomainException } from '../../../core/errors/domain-exception.js';
import { AiSettingsRepository, type ProviderRow } from './ai-settings.repository.js';
import { LlmProviderError, type LlmProvider } from './llm-provider.port.js';
import { OpenAiCompatibleProvider } from './openai-compatible.provider.js';

/** Провайдер и модель, выбранные для прогона (внутренний контракт движка). */
export interface ResolvedProvider {
  providerId: string;
  providerName: string;
  modelId: string;
  model: AssistantModel;
  instructions: string;
  provider: LlmProvider;
}

const headersSchema = z.array(assistantHeaderSchema);
const modelsSchema = z.array(assistantModelSchema);

/** JSONB-колонки: битое значение = пустой список (портал не падает). */
function parseHeaders(raw: unknown): { name: string; value: string }[] {
  const parsed = headersSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function parseModels(raw: unknown): AssistantModel[] {
  const parsed = modelsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** Таймаут проверки соединения: админ ждёт ответа на экране. */
const TEST_TIMEOUT_MS = 25_000;

/**
 * Настройки провайдеров моделей (ADR-0044): чтение/запись, каталог моделей,
 * проверка соединения и выбор провайдера для прогона.
 *
 * Ключи: на запись — шифрование `SecretBoxService`; на чтение — только
 * `hasKey` и хвост. Расшифрованный ключ живёт в памяти вызова провайдера и
 * не попадает ни в БД, ни в ответы, ни в логи.
 */
@Injectable()
export class AiSettingsService {
  constructor(
    private readonly repo: AiSettingsRepository,
    private readonly secretBox: SecretBoxService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AiSettingsService.name);
  }

  async get(): Promise<AiSettingsResponse> {
    const [providers, settings] = await Promise.all([
      this.repo.findProviders(),
      this.repo.findSettings(),
    ]);
    return {
      providers: providers.map((provider) => this.toDto(provider)),
      defaultProviderId: settings.defaultProviderId,
      defaultModelId: settings.defaultModelId,
      instructions: settings.instructions,
      limits: { ...AI_SETTINGS_LIMITS },
    };
  }

  /**
   * Полная замена настроек одним `PUT` (идемпотентно). Ключ пишется только
   * если передан (`apiKey`); `clearKey` удаляет; иначе сохраняется прежний —
   * форма не может «стереть» ключ, не зная его.
   */
  async put(body: AiSettingsBody): Promise<AiSettingsResponse> {
    const existing = new Map((await this.repo.findProviders()).map((row) => [row.id, row]));
    const providers = body.providers.map((input, index) => {
      const current = input.id ? existing.get(input.id) : undefined;
      this.assertProviderKeyConsistency(input);
      let ciphertext = current?.apiKeyCiphertext ?? null;
      let hint = current?.apiKeyHint ?? null;
      if (input.apiKey) {
        ciphertext = this.secretBox.seal(input.apiKey);
        hint = this.secretBox.hint(input.apiKey);
      } else if (input.clearKey) {
        ciphertext = null;
        hint = null;
      }
      return {
        id: input.id ?? randomUUID(),
        name: input.name,
        baseUrl: input.baseUrl.replace(/\/+$/, ''),
        apiFormat: input.apiFormat,
        authType: input.authType,
        apiKeyCiphertext: ciphertext,
        apiKeyHint: hint,
        headers: input.headers,
        enabled: input.enabled,
        models: input.models,
        sortOrder: index,
      };
    });

    const defaultProvider = providers.find((provider) => provider.id === body.defaultProviderId);
    if (body.defaultProviderId && !defaultProvider) {
      throw DomainException.notFound('Провайдер по умолчанию не найден в списке');
    }
    if (body.defaultModelId) {
      const models = defaultProvider ? parseModels(defaultProvider.models) : [];
      if (!models.some((model) => model.id === body.defaultModelId)) {
        throw new DomainException(
          ErrorCode.VALIDATION_FAILED,
          'Модель по умолчанию не принадлежит выбранному провайдеру',
          { field: 'defaultModelId' },
        );
      }
    }

    await this.repo.replaceAll(providers, {
      defaultProviderId: body.defaultProviderId,
      defaultModelId: body.defaultModelId,
      instructions: body.instructions.trim(),
    });
    return this.get();
  }

  /** Каталог `/models` провайдера — для кнопки «Загрузить модели». */
  async listModels(providerId: string): Promise<AssistantModelCatalogResponse> {
    const row = await this.requireProvider(providerId);
    const provider = this.providerForRow(row);
    try {
      return { models: await provider.listModels() };
    } catch (error) {
      throw this.providerFailure(error, 'Не удалось получить список моделей');
    }
  }

  /**
   * Проверка соединения: `/models` (если моделей нет) + короткий ответ.
   * Результат — данными (`ok: false` с кодом), а не HTTP-ошибкой: экран
   * настроек показывает причину без «красного» сбоя всей формы.
   */
  async test(providerId: string): Promise<AssistantProviderTestResponse> {
    const row = await this.requireProvider(providerId);
    const provider = this.providerForRow(row);
    const started = Date.now();
    let model = parseModels(row.models).find((item) => item.enabled)?.id ?? null;
    try {
      if (!model) {
        const catalog = await provider.listModels();
        model = catalog[0]?.id ?? null;
        if (!model) {
          return {
            ok: false,
            latencyMs: Date.now() - started,
            model: null,
            sample: null,
            errorCode: 'provider_error',
            errorMessage: 'Провайдер не вернул ни одной модели',
          };
        }
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
      let sample = '';
      try {
        for await (const event of provider.streamChat({
          model,
          messages: [{ role: 'user', content: 'Ответь одним словом: работает' }],
          signal: controller.signal,
          extra: { max_tokens: 32 },
        })) {
          if (event.type === 'text.delta') sample += event.text;
          if (sample.length >= 120) break;
        }
      } finally {
        clearTimeout(timer);
      }
      return {
        ok: true,
        latencyMs: Date.now() - started,
        model,
        sample: sample.trim().slice(0, 200) || null,
        errorCode: null,
        errorMessage: null,
      };
    } catch (error) {
      const failure = this.providerFailure(error, 'Проверка не прошла');
      return {
        ok: false,
        latencyMs: Date.now() - started,
        model,
        sample: null,
        errorCode: failure.code,
        errorMessage: failure.message,
      };
    }
  }

  /**
   * Провайдер и модель для прогона: дефолт из настроек, иначе первый
   * включённый провайдер с включённой моделью. Нет ничего — доменная ошибка
   * `ASSISTANT_PROVIDER_NOT_CONFIGURED` (UI покажет «не настроен»).
   */
  async resolveForRun(): Promise<ResolvedProvider> {
    const [rows, settings] = await Promise.all([
      this.repo.findProviders(),
      this.repo.findSettings(),
    ]);
    const enabled = rows.filter((row) => row.enabled);
    const row =
      enabled.find((item) => item.id === settings.defaultProviderId) ?? enabled[0] ?? null;
    if (!row) {
      throw new DomainException(
        ErrorCode.ASSISTANT_PROVIDER_NOT_CONFIGURED,
        'Провайдер моделей не настроен',
      );
    }
    const models = parseModels(row.models).filter((model) => model.enabled);
    const model =
      models.find((item) => item.id === settings.defaultModelId) ??
      models.find((item) => item.tools) ??
      models[0] ??
      null;
    if (!model) {
      throw new DomainException(
        ErrorCode.ASSISTANT_PROVIDER_NOT_CONFIGURED,
        'У провайдера нет включённых моделей',
        { providerId: row.id },
      );
    }
    return {
      providerId: row.id,
      providerName: row.name,
      modelId: model.id,
      model,
      instructions: settings.instructions,
      provider: this.providerForRow(row),
    };
  }

  private toDto(row: ProviderRow): AssistantProvider {
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
  private providerForRow(row: ProviderRow): LlmProvider {
    const apiKey = row.apiKeyCiphertext ? this.secretBox.open(row.apiKeyCiphertext) : null;
    if (row.apiKeyCiphertext && apiKey === null) {
      // Ключ сохранён, но не расшифровывается (сменился материал шифрования):
      // честная ошибка вместо тихого 401 от провайдера.
      this.logger.warn({ providerId: row.id }, 'Provider api key cannot be decrypted');
    }
    return new OpenAiCompatibleProvider({
      baseUrl: row.baseUrl,
      authType: row.authType === 'x-api-key' ? 'x-api-key' : 'bearer',
      apiKey,
      headers: parseHeaders(row.headers),
    });
  }

  private async requireProvider(providerId: string): Promise<ProviderRow> {
    const row = await this.repo.findProvider(providerId);
    if (!row) {
      throw new DomainException(ErrorCode.ASSISTANT_PROVIDER_NOT_FOUND, 'Провайдер не найден');
    }
    return row;
  }

  /** Единый маппинг сбоев провайдера: доменная ошибка 502 для API-маршрутов. */
  private providerFailure(error: unknown, fallback: string): LlmProviderError {
    if (error instanceof LlmProviderError) return error;
    if (error instanceof DomainException) {
      return new LlmProviderError('provider_error', error.message);
    }
    this.logger.warn({ err: error }, 'Provider request failed');
    return new LlmProviderError('provider_unavailable', fallback);
  }

  /** Задать и удалить ключ одновременно нельзя: форма не может «угадать». */
  private assertProviderKeyConsistency(input: { apiKey?: string; clearKey?: boolean }): void {
    if (input.apiKey && input.clearKey) {
      throw new DomainException(
        ErrorCode.VALIDATION_FAILED,
        'Нельзя одновременно задать и удалить ключ',
        { field: 'apiKey' },
      );
    }
  }
}
