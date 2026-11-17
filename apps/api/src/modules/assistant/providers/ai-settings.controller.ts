import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  aiSettingsBodySchema,
  aiSettingsResponseSchema,
  assistantModelCatalogResponseSchema,
  assistantProviderTestResponseSchema,
  Permission,
  type AiSettingsBody,
  type AiSettingsResponse,
  type AssistantModelCatalogResponse,
  type AssistantProviderTestResponse,
} from '@nodus/contracts';
import { z } from 'zod';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { AiSettingsService } from './ai-settings.service.js';

/** Path-параметр: не-UUID — 400 `VALIDATION_FAILED`, не 500 из Prisma. */
const uuidPipe = new ZodValidationPipe(z.uuid());

/**
 * Настройки ИИ-агента (`/api/v1/settings/ai`, #891/#894, ADR-0044): провайдеры
 * OpenAI-совместимого формата, модели, дефолт и правила ассистента.
 *
 * Доступ — право `portal.settings.manage` (I8) и флаг `assistant` (I10).
 * Ключи провайдеров наружу не возвращаются: только `hasKey` и хвост.
 */
@ApiTags('settings')
@ApiBearerAuth()
@RequireFeature('assistant')
@RequirePermissions(Permission.PORTAL_SETTINGS_MANAGE)
@Controller('settings/ai')
export class AiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Настройки ИИ-агента: провайдеры без ключей, дефолт, правила' })
  @ApiOkResponse({ standardSchema: aiSettingsResponseSchema })
  @ApiErrors(401, 403, 404)
  get(): Promise<AiSettingsResponse> {
    return this.settings.get();
  }

  @Put()
  @HttpCode(200)
  @Audit({ action: 'settings.ai_update', entity: 'assistant_settings' })
  @ApiOperation({ summary: 'Заменить настройки ИИ-агента (ключ пишется, только если передан)' })
  @ApiOkResponse({ standardSchema: aiSettingsResponseSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  put(
    @Body({
      schema: aiSettingsBodySchema,
      pipes: [new ZodValidationPipe(aiSettingsBodySchema)],
    })
    body: AiSettingsBody,
  ): Promise<AiSettingsResponse> {
    return this.settings.put(body);
  }

  @Get('providers/:id/models')
  @ApiOperation({ summary: 'Каталог моделей провайдера (нормализованный)' })
  @ApiOkResponse({ standardSchema: assistantModelCatalogResponseSchema })
  @ApiErrors(401, 403, 404, 502)
  listModels(@Param('id', uuidPipe) id: string): Promise<AssistantModelCatalogResponse> {
    return this.settings.listModels(id);
  }

  @Post('providers/:id/test')
  @HttpCode(200)
  @Audit({ action: 'settings.ai_provider_test', entity: 'assistant_provider' })
  @ApiOperation({ summary: 'Проверка соединения с провайдером и ответа модели' })
  @ApiOkResponse({ standardSchema: assistantProviderTestResponseSchema })
  @ApiErrors(401, 403, 404)
  @ApiIdempotencyKey()
  test(@Param('id', uuidPipe) id: string): Promise<AssistantProviderTestResponse> {
    return this.settings.test(id);
  }
}
