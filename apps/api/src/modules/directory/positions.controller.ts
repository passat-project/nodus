import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  positionSchema,
  type AuthUser,
  createPositionSchema,
  orgUnitKindSchema,
  Permission,
  reassignPositionSchema,
  updatePositionSchema,
  type CreatePositionDto,
  type OrgUnitKind,
  type Position,
  type ReassignPositionDto,
  type UpdatePositionDto,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { PositionsService } from './positions.service.js';

const listQuerySchema = z.object({
  kind: orgUnitKindSchema.default('management'),
  includeArchived: z.stringbool().default(false),
});

/** Должности (`/api/v1/directory/positions`): справочник, CRUD, удаление. */
@ApiTags('directory')
@ApiBearerAuth()
@Controller('directory/positions')
export class PositionsController {
  constructor(private readonly positionsService: PositionsService) {}

  @Get()
  @RequirePermissions(Permission.DIRECTORY_READ)
  @ApiOperation({ summary: 'Список должностей (фильтр по виду и архиву)' })
  @ApiOkResponse({ standardSchema: positionSchema, isArray: true })
  @ApiErrors(400, 401, 403)
  list(
    @Query({ schema: listQuerySchema, pipes: [new ZodValidationPipe(listQuerySchema)] })
    query: {
      kind: OrgUnitKind;
      includeArchived: boolean;
    },
  ): Promise<Position[]> {
    return this.positionsService.list(query.kind, query.includeArchived);
  }

  @Post()
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.position.create', entity: 'position' })
  @ApiOperation({ summary: 'Создание должности' })
  @ApiCreatedResponse({ standardSchema: positionSchema })
  @ApiErrors(400, 401, 403, 409)
  @ApiIdempotencyKey()
  create(
    @Body({ schema: createPositionSchema, pipes: [new ZodValidationPipe(createPositionSchema)] })
    dto: CreatePositionDto,
    @GetUser() actor: AuthUser,
  ): Promise<Position> {
    return this.positionsService.create(dto, actor.id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.position.update', entity: 'position' })
  @ApiOperation({ summary: 'Обновление должности' })
  @ApiParam({
    name: 'id',
    description: 'UUID должности',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: positionSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  update(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body({ schema: updatePositionSchema, pipes: [new ZodValidationPipe(updatePositionSchema)] })
    dto: UpdatePositionDto,
    @GetUser() actor: AuthUser,
  ): Promise<Position> {
    return this.positionsService.update(id, dto, actor.id);
  }

  @Post(':id/reassign')
  @HttpCode(204)
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.position.reassign', entity: 'position' })
  @ApiOperation({ summary: 'Переназначить активных держателей на другую должность' })
  @ApiParam({
    name: 'id',
    description: 'UUID должности',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiNoContentResponse({ description: 'Держатели переназначены' })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  reassign(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body({
      schema: reassignPositionSchema,
      pipes: [new ZodValidationPipe(reassignPositionSchema)],
    })
    dto: ReassignPositionDto,
    @GetUser() actor: AuthUser,
  ): Promise<void> {
    return this.positionsService.reassign(id, dto, actor.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.position.delete', entity: 'position' })
  @ApiOperation({ summary: 'Удаление должности (строка деактивируется, I15)' })
  @ApiParam({
    name: 'id',
    description: 'UUID должности',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiNoContentResponse({ description: 'Должность удалена' })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  delete(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @GetUser() actor: AuthUser,
  ): Promise<void> {
    return this.positionsService.delete(id, actor.id);
  }
}
