import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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
  Permission,
  bulkCounterpartiesBodySchema,
  counterpartyBulkResultSchema,
  counterpartyCardSchema,
  counterpartyListItemSchema,
  counterpartyMatchSchema,
  createCounterpartyBodySchema,
  listCounterpartiesQuerySchema,
  paginatedSchema,
  similarCounterpartiesQuerySchema,
  updateCounterpartyBodySchema,
  type BulkCounterpartiesBody,
  type CounterpartyBulkResult,
  type CounterpartyCard,
  type CounterpartyListItem,
  type CounterpartyMatch,
  type CreateCounterpartyBody,
  type ListCounterpartiesQuery,
  type Paginated,
  type SimilarCounterpartiesQuery,
  type UpdateCounterpartyBody,
} from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import type { AuthUser } from '@nodus/contracts';
import { CounterpartiesQueryService } from './counterparties-query.service.js';
import { CounterpartiesService } from './counterparties.service.js';

const idParamSchema = z.uuid();

/**
 * Справочник контрагентов (`/api/v1/counterparties`, ADR-0033, модуль crm).
 * Чтение (реестр, карточка, похожие) — всем сотрудникам: справочник общий,
 * на него ссылаются письма и проекты. Создание (в т.ч. «на лету») —
 * `crm.create`, ведение — `crm.manage` (I8; по умолчанию администратор).
 * Модуль за фичефлагом `crm` (I10).
 */
@ApiTags('crm')
@ApiBearerAuth()
@RequireFeature('crm')
@Controller('counterparties')
export class CounterpartiesController {
  constructor(
    private readonly queries: CounterpartiesQueryService,
    private readonly counterparties: CounterpartiesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Реестр контрагентов (поиск по названию и УНП, архив)' })
  @ApiOkResponse({ standardSchema: paginatedSchema(counterpartyListItemSchema) })
  @ApiErrors(400, 401)
  list(
    @Query({
      schema: listCounterpartiesQuerySchema,
      pipes: [new ZodValidationPipe(listCounterpartiesQuerySchema)],
    })
    query: ListCounterpartiesQuery,
    @GetUser() actor: AuthUser,
  ): Promise<Paginated<CounterpartyListItem>> {
    return this.queries.list(query, actor);
  }

  // Статический сегмент объявлен раньше `:id`: Fastify матчит его первым.
  @Get('similar')
  @ApiOperation({ summary: 'Подсказка похожих контрагентов (точный УНП, нечёткое название)' })
  @ApiOkResponse({ standardSchema: z.array(counterpartyMatchSchema) })
  @ApiErrors(400, 401)
  similar(
    @Query({
      schema: similarCounterpartiesQuerySchema,
      pipes: [new ZodValidationPipe(similarCounterpartiesQuerySchema)],
    })
    query: SimilarCounterpartiesQuery,
  ): Promise<CounterpartyMatch[]> {
    return this.queries.similar(query);
  }

  @Post('bulk')
  @HttpCode(200)
  @RequirePermissions(Permission.CRM_MANAGE)
  @Audit({ action: 'crm.counterparty_bulk', entity: 'counterparty' })
  @ApiOperation({ summary: 'Массовая операция: архив/возврат до 100 контрагентов' })
  @ApiOkResponse({ standardSchema: counterpartyBulkResultSchema })
  @ApiErrors(400, 401, 403)
  @ApiIdempotencyKey()
  bulk(
    @Body({
      schema: bulkCounterpartiesBodySchema,
      pipes: [new ZodValidationPipe(bulkCounterpartiesBodySchema)],
    })
    dto: BulkCounterpartiesBody,
    @GetUser() actor: AuthUser,
  ): Promise<CounterpartyBulkResult> {
    return this.counterparties.bulk(dto.counterpartyIds, dto.action, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Карточка контрагента (в том числе архивная)' })
  @ApiParam({
    name: 'id',
    description: 'UUID контрагента',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: counterpartyCardSchema })
  @ApiErrors(400, 401, 404)
  card(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() actor: AuthUser,
  ): Promise<CounterpartyCard> {
    return this.queries.card(id, actor);
  }

  @Post()
  @RequirePermissions(Permission.CRM_CREATE)
  @Audit({ action: 'crm.counterparty_create', entity: 'counterparty' })
  @ApiOperation({ summary: 'Создание контрагента (в т.ч. «на лету» из регистрации письма)' })
  @ApiCreatedResponse({ standardSchema: counterpartyCardSchema })
  @ApiErrors(400, 401, 403, 409)
  @ApiIdempotencyKey()
  create(
    @Body({
      schema: createCounterpartyBodySchema,
      pipes: [new ZodValidationPipe(createCounterpartyBodySchema)],
    })
    dto: CreateCounterpartyBody,
    @GetUser() actor: AuthUser,
  ): Promise<CounterpartyCard> {
    return this.counterparties.create(dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.CRM_MANAGE)
  @Audit({ action: 'crm.counterparty_update', entity: 'counterparty' })
  @ApiOperation({ summary: 'Правка реквизитов контрагента (частичная)' })
  @ApiParam({
    name: 'id',
    description: 'UUID контрагента',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: counterpartyCardSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  update(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: updateCounterpartyBodySchema,
      pipes: [new ZodValidationPipe(updateCounterpartyBodySchema)],
    })
    dto: UpdateCounterpartyBody,
    @GetUser() actor: AuthUser,
  ): Promise<CounterpartyCard> {
    return this.counterparties.update(id, dto, actor);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(Permission.CRM_MANAGE)
  @Audit({ action: 'crm.counterparty_archive', entity: 'counterparty' })
  @ApiOperation({ summary: 'Перенос контрагента в архив (без удаления, ADR-0033)' })
  @ApiParam({
    name: 'id',
    description: 'UUID контрагента',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: counterpartyCardSchema })
  @ApiErrors(401, 403, 404)
  @ApiIdempotencyKey()
  archive(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() actor: AuthUser,
  ): Promise<CounterpartyCard> {
    return this.counterparties.setArchived(id, true, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.CRM_MANAGE)
  @Audit({ action: 'crm.counterparty_delete', entity: 'counterparty' })
  @ApiOperation({ summary: 'Удаление контрагента (только без связей; связанный — архив)' })
  @ApiParam({
    name: 'id',
    description: 'UUID контрагента',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiErrors(401, 403, 404, 409)
  @ApiIdempotencyKey()
  async remove(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() actor: AuthUser,
  ): Promise<void> {
    await this.counterparties.remove(id, actor.id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions(Permission.CRM_MANAGE)
  @Audit({ action: 'crm.counterparty_restore', entity: 'counterparty' })
  @ApiOperation({ summary: 'Возврат контрагента из архива' })
  @ApiParam({
    name: 'id',
    description: 'UUID контрагента',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: counterpartyCardSchema })
  @ApiErrors(401, 403, 404)
  @ApiIdempotencyKey()
  restore(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() actor: AuthUser,
  ): Promise<CounterpartyCard> {
    return this.counterparties.setArchived(id, false, actor);
  }
}
