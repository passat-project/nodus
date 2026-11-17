import { Controller, Delete, Get, HttpCode, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  assistantMemoryListSchema,
  Permission,
  type AssistantMemoryList,
  type AuthUser,
} from '@nodus/contracts';
import { z } from 'zod';

import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { AssistantMemoryService } from './assistant-memory.service.js';

/**
 * Блокнот агента (`/api/v1/assistant/memory`, #900): личные записи
 * сотрудника. Записи делает агент; сотрудник читает и удаляет. Чужая
 * запись — 404. Аудит — в сервисе (запись делает и прогон, без HTTP).
 */
@ApiTags('assistant')
@ApiBearerAuth()
@RequireFeature('assistant')
@RequirePermissions(Permission.ASSISTANT_USE)
@Controller('assistant/memory')
export class AssistantMemoryController {
  constructor(private readonly memory: AssistantMemoryService) {}

  @Get()
  @ApiOperation({ summary: 'Записи блокнота сотрудника (активные, до 50)' })
  @ApiOkResponse({ standardSchema: assistantMemoryListSchema })
  @ApiErrors(401, 403)
  list(@GetUser() user: AuthUser): Promise<AssistantMemoryList> {
    return this.memory.list(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Удалить запись блокнота (архив, не стирание)' })
  @ApiNoContentResponse()
  @ApiErrors(400, 401, 403, 404)
  async remove(
    @GetUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ): Promise<void> {
    await this.memory.forget(user.id, id);
  }
}
