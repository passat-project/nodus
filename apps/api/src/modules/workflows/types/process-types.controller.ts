import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  Permission,
  createProcessTypeBodySchema,
  processTypeListQuerySchema,
  processTypeSchema,
  updateProcessTypeBodySchema,
  updateProcessTypeConfigBodySchema,
  type AuthUser,
  type CreateProcessTypeBody,
  type ProcessType,
  type ProcessTypeListQuery,
  type UpdateProcessTypeBody,
  type UpdateProcessTypeConfigBody,
} from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequirePermissions } from '../../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { ProcessTypesService } from './process-types.service.js';

const uuid = new ZodValidationPipe(z.uuid());

/**
 * Библиотека типов процессов (ADR-0024): список — любой вошедший (решение
 * владельца: схемы видят все), мутации — `workflow.manage`. Пути статические
 * (`types/...`) — Fastify ставит их выше параметрического `:id`. Модуль
 * «Процессы» — ядро (I10), фичефлага нет.
 */
@ApiTags('workflows')
@ApiBearerAuth()
@Controller('workflows')
export class ProcessTypesController {
  constructor(private readonly types: ProcessTypesService) {}

  @Get('types')
  @ApiOperation({
    summary: 'Типы процессов (расширенный DTO; archived=include — с архивом)',
  })
  @ApiOkResponse({ standardSchema: z.array(processTypeSchema) })
  @ApiErrors(400, 401)
  list(
    @GetUser() user: AuthUser,
    @Query({
      schema: processTypeListQuerySchema,
      pipes: [new ZodValidationPipe(processTypeListQuerySchema)],
    })
    query: ProcessTypeListQuery,
  ): Promise<ProcessType[]> {
    return this.types.list(user, query.archived ?? 'exclude', query.category);
  }

  @Post('types')
  @RequirePermissions(Permission.WORKFLOW_MANAGE)
  @Audit({ action: 'workflow.type_create', entity: 'process_type' })
  @ApiOperation({
    summary:
      'Новый тип + маршрут из основы (копия живого типа той же категории/простой); тип скрыт',
  })
  @ApiCreatedResponse({ standardSchema: processTypeSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  create(
    @GetUser() user: AuthUser,
    @Body({
      schema: createProcessTypeBodySchema,
      pipes: [new ZodValidationPipe(createProcessTypeBodySchema)],
    })
    body: CreateProcessTypeBody,
  ): Promise<ProcessType> {
    return this.types.create(user, body);
  }

  @Patch('types/:id')
  @HttpCode(200)
  @RequirePermissions(Permission.WORKFLOW_MANAGE)
  @Audit({ action: 'workflow.type_update', entity: 'process_type' })
  @ApiOperation({ summary: 'Свойства типа (ставит customizedAt — каталог не трогает)' })
  @ApiOkResponse({ standardSchema: processTypeSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  update(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: updateProcessTypeBodySchema,
      pipes: [new ZodValidationPipe(updateProcessTypeBodySchema)],
    })
    body: UpdateProcessTypeBody,
  ): Promise<ProcessType> {
    return this.types.update(user, id, body);
  }

  @Patch('types/:id/config')
  @HttpCode(200)
  @RequirePermissions(Permission.WORKFLOW_MANAGE)
  @Audit({ action: 'workflow.type_config_update', entity: 'process_type' })
  @ApiOperation({
    summary: 'Настройки типа: состав карточки и доступ (разделы заменяются целиком)',
  })
  @ApiOkResponse({ standardSchema: processTypeSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  updateConfig(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body({
      schema: updateProcessTypeConfigBodySchema,
      pipes: [new ZodValidationPipe(updateProcessTypeConfigBodySchema)],
    })
    body: UpdateProcessTypeConfigBody,
  ): Promise<ProcessType> {
    return this.types.updateConfig(user, id, body);
  }

  @Post('types/:id/archive')
  @HttpCode(200)
  @RequirePermissions(Permission.WORKFLOW_MANAGE)
  @Audit({ action: 'workflow.type_archive', entity: 'process_type' })
  @ApiOperation({ summary: 'Тип в архив (системный — 409)' })
  @ApiOkResponse({ standardSchema: processTypeSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  archive(@GetUser() user: AuthUser, @Param('id', uuid) id: string): Promise<ProcessType> {
    return this.types.setArchived(user, id, true);
  }

  @Post('types/:id/restore')
  @HttpCode(200)
  @RequirePermissions(Permission.WORKFLOW_MANAGE)
  @Audit({ action: 'workflow.type_restore', entity: 'process_type' })
  @ApiOperation({ summary: 'Вернуть тип из архива' })
  @ApiOkResponse({ standardSchema: processTypeSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  restore(@GetUser() user: AuthUser, @Param('id', uuid) id: string): Promise<ProcessType> {
    return this.types.setArchived(user, id, false);
  }
}
