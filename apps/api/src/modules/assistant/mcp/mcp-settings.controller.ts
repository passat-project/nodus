import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  assistantMcpBodySchema,
  assistantMcpResponseSchema,
  assistantMcpTestResponseSchema,
  Permission,
  type AssistantMcpBody,
  type AssistantMcpResponse,
  type AssistantMcpTestResponse,
} from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { McpSettingsService } from './mcp-settings.service.js';

/**
 * Реестр внешних MCP-серверов (`/api/v1/settings/ai/mcp`, #902, ADR-0043
 * п. 10): адрес, транспорт, ключ и «по умолчанию для поиска».
 *
 * Доступ — право `portal.settings.manage` (I8) и флаг `assistant` (I10).
 * Ключи наружу не возвращаются: только `hasKey` и хвост.
 */
@ApiTags('settings')
@ApiBearerAuth()
@RequireFeature('assistant')
@RequirePermissions(Permission.PORTAL_SETTINGS_MANAGE)
@Controller('settings/ai/mcp')
export class McpSettingsController {
  constructor(private readonly settings: McpSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'MCP-серверы: адреса без ключей, признак «по умолчанию»' })
  @ApiOkResponse({ standardSchema: assistantMcpResponseSchema })
  @ApiErrors(401, 403, 404)
  get(): Promise<AssistantMcpResponse> {
    return this.settings.get();
  }

  @Put()
  @HttpCode(200)
  @Audit({ action: 'settings.ai_mcp_update', entity: 'assistant_mcp_server' })
  @ApiOperation({ summary: 'Заменить список MCP-серверов (ключ пишется, только если передан)' })
  @ApiOkResponse({ standardSchema: assistantMcpResponseSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  put(
    @Body({
      schema: assistantMcpBodySchema,
      pipes: [new ZodValidationPipe(assistantMcpBodySchema)],
    })
    body: AssistantMcpBody,
  ): Promise<AssistantMcpResponse> {
    return this.settings.put(body);
  }

  @Post(':id/test')
  @HttpCode(200)
  @Audit({ action: 'settings.ai_mcp_test', entity: 'assistant_mcp_server' })
  @ApiOperation({ summary: 'Проверка соединения: handshake MCP и список инструментов' })
  @ApiOkResponse({ standardSchema: assistantMcpTestResponseSchema })
  @ApiErrors(401, 403, 404)
  @ApiIdempotencyKey()
  test(@Param('id') id: string): Promise<AssistantMcpTestResponse> {
    return this.settings.test(id);
  }
}
