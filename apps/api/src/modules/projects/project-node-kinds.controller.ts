import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
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
  nodeKindCreateBodySchema,
  nodeKindListSchema,
  nodeKindSchema,
  nodeKindUpdateBodySchema,
  type AuthUser,
  type NodeKind,
  type NodeKindCreateBody,
  type NodeKindUpdateBody,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { NodeKindsService } from './node-kinds.service.js';

const idParamSchema = z.uuid();

/**
 * Справочник видов папок структуры (#467, #556, ADR-0030 «Дополнение»):
 * ярлык (значок + цвет) и конфигурация вида (форма создания + возможности);
 * создание/правка/архивация — `project.setup.manage` («Автоматизация →
 * Схемы проектов»). Удаление = архивация: папки архивного вида не создаются,
 * существующие живут. Имя уникально без учёта регистра и пробелов
 * (lower(btrim(name))). Логика — NodeKindsService (лок, события); здесь —
 * аудит, права и OpenAPI. Статический маршрут `projects/node-kinds`
 * фармуется раньше параметрических `projects/:id`.
 */
@ApiTags('projects')
@ApiBearerAuth()
@RequireFeature('projects')
@Controller()
export class ProjectNodeKindsController {
  constructor(private readonly nodeKinds: NodeKindsService) {}

  @Get('projects/node-kinds')
  @ApiOperation({ summary: 'Виды папок: форма, возможности, архивные в конце' })
  @ApiOkResponse({ standardSchema: nodeKindListSchema })
  @ApiErrors(400, 401)
  nodeKindsList(): Promise<NodeKind[]> {
    return this.nodeKinds.list();
  }

  @Post('projects/node-kinds')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'project.node_kind_create', entity: 'node_kind' })
  @ApiOperation({ summary: 'Новый вид папки (ярлык: значок + цвет)' })
  @ApiCreatedResponse({ standardSchema: nodeKindSchema })
  @ApiErrors(400, 401, 403, 409)
  @ApiIdempotencyKey()
  nodeKindCreate(
    @Body({
      schema: nodeKindCreateBodySchema,
      pipes: [new ZodValidationPipe(nodeKindCreateBodySchema)],
    })
    dto: NodeKindCreateBody,
    @GetUser() user: AuthUser,
  ): Promise<NodeKind> {
    return this.nodeKinds.create(dto, user.id);
  }

  @Patch('projects/node-kinds/:id')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'project.node_kind_update', entity: 'node_kind' })
  @ApiParam({ name: 'id', description: 'UUID вида', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary: 'Правка вида папки: имя, значок, цвет, форма (раздел целиком), возможности',
  })
  @ApiOkResponse({ standardSchema: nodeKindSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  nodeKindUpdate(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: nodeKindUpdateBodySchema,
      pipes: [new ZodValidationPipe(nodeKindUpdateBodySchema)],
    })
    dto: NodeKindUpdateBody,
    @GetUser() user: AuthUser,
  ): Promise<NodeKind> {
    return this.nodeKinds.update(id, dto, user.id);
  }

  @Delete('projects/node-kinds/:id')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'project.node_kind_archive', entity: 'node_kind' })
  @ApiParam({ name: 'id', description: 'UUID вида', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Архивировать вид папки (папки такого вида больше не создаются)' })
  @ApiOkResponse({ standardSchema: nodeKindSchema })
  @ApiErrors(400, 401, 403, 404)
  nodeKindArchive(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() user: AuthUser,
  ): Promise<NodeKind> {
    return this.nodeKinds.archive(id, user.id);
  }

  @Post('projects/node-kinds/:id/restore')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'project.node_kind_restore', entity: 'node_kind' })
  @ApiParam({ name: 'id', description: 'UUID вида', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Вернуть вид папки из архива' })
  @ApiOkResponse({ standardSchema: nodeKindSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  nodeKindRestore(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() user: AuthUser,
  ): Promise<NodeKind> {
    return this.nodeKinds.restore(id, user.id);
  }
}
