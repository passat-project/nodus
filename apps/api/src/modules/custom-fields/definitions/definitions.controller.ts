import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  createCustomFieldBodySchema,
  customFieldBindingKindSchema,
  customFieldCompanyValueBodySchema,
  customFieldDefinitionSchema,
  customFieldUsageSchema,
  listCustomFieldsQuerySchema,
  Permission,
  reorderCustomFieldsBodySchema,
  updateCustomFieldBodySchema,
  type CreateCustomFieldBody,
  type CustomFieldCompanyValueBody,
  type CustomFieldDefinition,
  type CustomFieldUsage,
  type ListCustomFieldsQuery,
  type ReorderCustomFieldsBody,
  type UpdateCustomFieldBody,
} from '@nodus/contracts';
import type { AuthUser, CustomFieldBindingKind } from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequirePermissions } from '../../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { DefinitionsBindingService } from './definitions-binding.service.js';
import { DefinitionsService } from './definitions.service.js';

const idParamSchema = z.uuid();
const targetIdParamSchema = z.uuid();

/**
 * Реестр атрибутов портала (`/api/v1/custom-fields/definitions`, ADR-0029,
 * #631). Чтение — всем аутентифицированным (карточки, фильтры, окна
 * переходов нужны каждому); управление — правом `custom_field.manage`
 * (по умолчанию администратор, I8).
 */
@ApiTags('custom-fields')
@ApiBearerAuth()
@Controller('custom-fields/definitions')
export class DefinitionsController {
  constructor(
    private readonly definitions: DefinitionsService,
    private readonly bindings: DefinitionsBindingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Реестр атрибутов портала (module — фильтр мест использования)' })
  @ApiOkResponse({ standardSchema: z.array(customFieldDefinitionSchema) })
  @ApiErrors(400, 401)
  list(
    @Query({
      schema: listCustomFieldsQuerySchema,
      pipes: [new ZodValidationPipe(listCustomFieldsQuerySchema)],
    })
    query: ListCustomFieldsQuery,
  ): Promise<CustomFieldDefinition[]> {
    return this.definitions.list(query.module ?? null);
  }

  @Post()
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @Audit({ action: 'custom_field.create', entity: 'field_definition' })
  @ApiOperation({
    summary: 'Новый атрибут портала (имя глобально уникально; 409 — с suggestion)',
  })
  @ApiCreatedResponse({ standardSchema: customFieldDefinitionSchema })
  @ApiErrors(400, 401, 403, 409, 422)
  @ApiIdempotencyKey()
  create(
    @Body({
      schema: createCustomFieldBodySchema,
      pipes: [new ZodValidationPipe(createCustomFieldBodySchema)],
    })
    dto: CreateCustomFieldBody,
    @GetUser() actor: AuthUser,
  ): Promise<CustomFieldDefinition> {
    return this.definitions.create(dto, actor.id);
  }

  // Буквальный сегмент объявлен раньше `:id` (Fastify матчит его первым).
  @Put('order')
  @HttpCode(204)
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @Audit({ action: 'custom_field.reorder', entity: 'field_definition' })
  @ApiOperation({ summary: 'Порядок атрибутов портала (ids = ровно все атрибуты)' })
  @ApiErrors(400, 401, 403, 409)
  @ApiIdempotencyKey()
  async reorder(
    @Body({
      schema: reorderCustomFieldsBodySchema,
      pipes: [new ZodValidationPipe(reorderCustomFieldsBodySchema)],
    })
    dto: ReorderCustomFieldsBody,
    @GetUser() actor: AuthUser,
  ): Promise<void> {
    await this.definitions.reorder(dto, actor.id);
  }

  @Get(':id/usage')
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @ApiOperation({ summary: 'Где используется атрибут: значения, формы, маршруты, привязки' })
  @ApiParam({
    name: 'id',
    description: 'UUID атрибута',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: customFieldUsageSchema })
  @ApiErrors(400, 401, 403, 404)
  usage(@Param('id', new ZodValidationPipe(idParamSchema)) id: string): Promise<CustomFieldUsage> {
    return this.definitions.usage(id);
  }

  // Привязка «Где используется» (Р3 #631): идемпотентна, ответ — DTO.
  // Буквальный сегмент `bindings` объявлен раньше `:id`.
  @Put(':id/bindings/:kind/:targetId')
  @HttpCode(200)
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @Audit({ action: 'custom_field.bind', entity: 'field_definition' })
  @ApiOperation({ summary: 'Привязать атрибут к месту (повтор — без изменений)' })
  @ApiParam({
    name: 'id',
    description: 'UUID атрибута',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiParam({
    name: 'kind',
    description: 'process-type | project-type | node-kind',
    schema: { type: 'string', enum: ['process-type', 'project-type', 'node-kind'] },
  })
  @ApiParam({
    name: 'targetId',
    description: 'UUID цели (тип процесса/проекта или вид папки)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: customFieldDefinitionSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  bind(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('kind', new ZodValidationPipe(customFieldBindingKindSchema))
    kind: CustomFieldBindingKindParam,
    @Param('targetId', new ZodValidationPipe(targetIdParamSchema)) targetId: string,
    @GetUser() actor: AuthUser,
  ): Promise<CustomFieldDefinition> {
    return this.bindings.bind(id, kind, targetId, actor.id);
  }

  @Delete(':id/bindings/:kind/:targetId')
  @HttpCode(200)
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @Audit({ action: 'custom_field.unbind', entity: 'field_definition' })
  @ApiOperation({ summary: 'Снять привязку атрибута с места (разрешено всегда)' })
  @ApiParam({
    name: 'id',
    description: 'UUID атрибута',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiParam({
    name: 'kind',
    description: 'process-type | project-type | node-kind',
    schema: { type: 'string', enum: ['process-type', 'project-type', 'node-kind'] },
  })
  @ApiParam({
    name: 'targetId',
    description: 'UUID цели (тип процесса/проекта или вид папки)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: customFieldDefinitionSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  unbind(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('kind', new ZodValidationPipe(customFieldBindingKindSchema))
    kind: CustomFieldBindingKindParam,
    @Param('targetId', new ZodValidationPipe(targetIdParamSchema)) targetId: string,
    @GetUser() actor: AuthUser,
  ): Promise<CustomFieldDefinition> {
    return this.bindings.unbind(id, kind, targetId, actor.id);
  }

  @Put(':id/company-value')
  @HttpCode(200)
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @Audit({ action: 'custom_field.company_value', entity: 'field_definition' })
  @ApiOperation({ summary: 'Значение глобальной переменной (null — очистить)' })
  @ApiParam({
    name: 'id',
    description: 'UUID атрибута',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: customFieldDefinitionSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  companyValue(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: customFieldCompanyValueBodySchema,
      pipes: [new ZodValidationPipe(customFieldCompanyValueBodySchema)],
    })
    dto: CustomFieldCompanyValueBody,
    @GetUser() actor: AuthUser,
  ): Promise<CustomFieldDefinition> {
    return this.definitions.setCompanyValue(id, dto.value, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @Audit({ action: 'custom_field.update', entity: 'field_definition' })
  @ApiOperation({ summary: 'Правка атрибута (тип — только расширяющая смена)' })
  @ApiParam({
    name: 'id',
    description: 'UUID атрибута',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: customFieldDefinitionSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  update(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: updateCustomFieldBodySchema,
      pipes: [new ZodValidationPipe(updateCustomFieldBodySchema)],
    })
    dto: UpdateCustomFieldBody,
    @GetUser() actor: AuthUser,
  ): Promise<CustomFieldDefinition> {
    return this.definitions.update(id, dto, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @Audit({ action: 'custom_field.delete', entity: 'field_definition' })
  @ApiOperation({ summary: 'Удаление атрибута (разрешено всегда; окно последствий — usage)' })
  @ApiParam({
    name: 'id',
    description: 'UUID атрибута',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  async remove(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() actor: AuthUser,
  ): Promise<void> {
    await this.definitions.remove(id, actor.id);
  }
}

type CustomFieldBindingKindParam = CustomFieldBindingKind;
