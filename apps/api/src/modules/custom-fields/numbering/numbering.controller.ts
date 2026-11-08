import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  numberBackfillBodySchema,
  numberCountsQuerySchema,
  numberCountsResponseSchema,
  numberCoverageResultSchema,
  numberHostAssignmentsSchema,
  numberHostKindSchema,
  type NumberHostKind,
  numberPreviewResultSchema,
  Permission,
  setNumberNextBodySchema,
  type AuthUser,
  type NumberBackfillBody,
  type NumberCountsQuery,
  type NumberCoverageBody,
  type NumberPreviewBody,
  type SetNumberNextBody,
} from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequirePermissions } from '../../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NumberingApiService } from './numbering-api.service.js';

const idParamSchema = z.uuid();
/**
 * API счётчиков (#630, модель v3): охват правила, «Проверка на записи»,
 * «Текущие счета», «Следующий номер», выдача существующим и номера записи.
 * Настройка и счета — `custom_field.manage`; номера записи — тем, кто видит
 * запись (проверяет реестр носителей).
 */
@ApiTags('custom-fields')
@ApiBearerAuth()
@Controller('custom-fields')
export class NumberingController {
  constructor(
    private readonly numbering: NumberingApiService,
    private readonly txRunner: TransactionRunner,
  ) {}

  @Post('numbering/coverage')
  @HttpCode(200)
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @ApiOperation({ summary: 'Охват правила: сколько существующих записей лежат внутри счёта' })
  @ApiOkResponse({ standardSchema: numberCoverageResultSchema })
  @ApiErrors(400, 401, 403)
  coverage(@Body() body: NumberCoverageBody, @GetUser() actor: AuthUser) {
    return this.txRunner.run((tx) =>
      this.numbering.coverage(tx, actor, body.rule, body.participantTypeIds),
    );
  }

  @Post('numbering/preview')
  @HttpCode(200)
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @ApiOperation({ summary: 'Проверка на записи: какой номер получит запись (не тратит)' })
  @ApiOkResponse({ standardSchema: numberPreviewResultSchema })
  @ApiErrors(400, 401, 403, 404)
  preview(@Body() body: NumberPreviewBody, @GetUser() actor: AuthUser) {
    return this.txRunner.run((tx) => this.numbering.preview(tx, actor, body));
  }

  @Get('definitions/:id/numbering/counts')
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @ApiOperation({ summary: 'Текущие счета счётчика: последний и следующий номер' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ standardSchema: numberCountsResponseSchema })
  @ApiErrors(400, 401, 403, 404)
  counts(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Query({
      schema: numberCountsQuerySchema,
      pipes: [new ZodValidationPipe(numberCountsQuerySchema)],
    })
    query: NumberCountsQuery,
    @GetUser() actor: AuthUser,
  ) {
    return this.txRunner.run((tx) => this.numbering.counts(tx, id, actor, query.q ?? ''));
  }

  @Put('definitions/:id/numbering/next')
  @HttpCode(200)
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @Audit({ action: 'custom_field.number_next', entity: 'field_definition' })
  @ApiOperation({ summary: 'Следующий номер счёта — только вперёд (продолжение из Excel)' })
  @ApiOkResponse({ standardSchema: numberCountsResponseSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  next(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: setNumberNextBodySchema,
      pipes: [new ZodValidationPipe(setNumberNextBodySchema)],
    })
    body: SetNumberNextBody,
    @GetUser() actor: AuthUser,
  ) {
    return this.txRunner.run((tx) => this.numbering.setNext(tx, id, actor, body));
  }

  @Post('definitions/:id/numbering/backfill/preview')
  @HttpCode(200)
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @ApiOperation({ summary: 'Выдача существующим: предпросмотр (ничего не тратит)' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiErrors(400, 401, 403, 404)
  backfillPreview(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() actor: AuthUser,
  ) {
    return this.txRunner.run((tx) => this.numbering.backfillPreview(tx, id, actor));
  }

  @Post('definitions/:id/numbering/backfill')
  @HttpCode(200)
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @Audit({ action: 'custom_field.number_backfill', entity: 'field_definition' })
  @ApiOperation({ summary: 'Выдать номера существующим записям (одобрение из окна)' })
  @ApiParam({ name: 'id', schema: { type: 'string', format: 'uuid' } })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  backfill(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: numberBackfillBodySchema,
      pipes: [new ZodValidationPipe(numberBackfillBodySchema)],
    })
    body: NumberBackfillBody,
    @GetUser() actor: AuthUser,
  ) {
    return this.numbering.backfill(this.txRunner, id, actor, body);
  }

  @Get('numbering/host/:kind/:id')
  @ApiOperation({ summary: 'Номера записи: кто, когда, каким способом и в каком счёте' })
  @ApiOkResponse({ standardSchema: numberHostAssignmentsSchema })
  @ApiErrors(400, 401, 404)
  hostAssignments(
    @Param('kind', new ZodValidationPipe(numberHostKindSchema)) kind: NumberHostKind,
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() actor: AuthUser,
  ) {
    return this.txRunner.run((tx) => this.numbering.hostAssignments(tx, actor, kind, id));
  }
}
