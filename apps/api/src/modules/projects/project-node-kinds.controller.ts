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
  ErrorCode,
  Permission,
  nodeKindCreateBodySchema,
  nodeKindListSchema,
  nodeKindSchema,
  nodeKindUpdateBodySchema,
  type NodeKind,
  type NodeKindCreateBody,
  type NodeKindUpdateBody,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { NodeKindsRepository } from './project-node-kinds.repository.js';

const idParamSchema = z.uuid();

/**
 * Справочник видов уровней структуры (#467, ADR-0030 «Дополнение»): ярлык
 * узла — значок + цвет; создание/правка/архивация — `project.setup.manage`
 * («Автоматизация → Типы проектов»). Удаление = архивация: узлы архивного
 * вида не создаются, существующие живут. Имя уникально без учёта регистра
 * и пробелов (lower(btrim(name))). Статический маршрут `projects/node-kinds`
 * фармуется раньше параметрических `projects/:id`.
 */
@ApiTags('projects')
@ApiBearerAuth()
@RequireFeature('projects')
@Controller()
export class ProjectNodeKindsController {
  constructor(
    private readonly nodeKinds: NodeKindsRepository,
    private readonly txRunner: TransactionRunner,
  ) {}

  @Get('projects/node-kinds')
  @ApiOperation({ summary: 'Виды уровней узлов (живые по имени, архивные в конце)' })
  @ApiOkResponse({ standardSchema: nodeKindListSchema })
  @ApiErrors(400, 401)
  nodeKindsList(): Promise<NodeKind[]> {
    return this.nodeKinds.list();
  }

  @Post('projects/node-kinds')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'project.node_kind_create', entity: 'node_kind' })
  @ApiOperation({ summary: 'Новый вид уровня (ярлык узла: значок + цвет)' })
  @ApiCreatedResponse({ standardSchema: nodeKindSchema })
  @ApiErrors(400, 401, 403, 409)
  @ApiIdempotencyKey()
  nodeKindCreate(
    @Body({
      schema: nodeKindCreateBodySchema,
      pipes: [new ZodValidationPipe(nodeKindCreateBodySchema)],
    })
    dto: NodeKindCreateBody,
  ): Promise<NodeKind> {
    return this.txRunner.run(async (tx) => {
      if (await this.nodeKinds.nameTaken(dto.name, null)) {
        throw new DomainException(
          ErrorCode.PROJECT_NODE_KIND_NAME_TAKEN,
          'Node kind name is already taken',
          { name: dto.name },
        );
      }
      return this.nodeKinds.create(tx, dto);
    });
  }

  @Patch('projects/node-kinds/:id')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'project.node_kind_update', entity: 'node_kind' })
  @ApiParam({ name: 'id', description: 'UUID вида', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Правка вида уровня: имя, значок, цвет' })
  @ApiOkResponse({ standardSchema: nodeKindSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  nodeKindUpdate(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: nodeKindUpdateBodySchema,
      pipes: [new ZodValidationPipe(nodeKindUpdateBodySchema)],
    })
    dto: NodeKindUpdateBody,
  ): Promise<NodeKind> {
    return this.txRunner.run(async (tx) => {
      if (dto.name !== undefined && (await this.nodeKinds.nameTaken(dto.name, id))) {
        throw new DomainException(
          ErrorCode.PROJECT_NODE_KIND_NAME_TAKEN,
          'Node kind name is already taken',
          { name: dto.name },
        );
      }
      const updated = await this.nodeKinds.update(tx, id, dto);
      if (!updated) throw DomainException.notFound('Node kind not found');
      return updated;
    });
  }

  @Delete('projects/node-kinds/:id')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'project.node_kind_archive', entity: 'node_kind' })
  @ApiParam({ name: 'id', description: 'UUID вида', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary: 'Архивировать вид уровня (узлы такого вида больше не создаются)',
  })
  @ApiOkResponse({ standardSchema: nodeKindSchema })
  @ApiErrors(400, 401, 403, 404)
  nodeKindArchive(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
  ): Promise<NodeKind> {
    return this.txRunner.run(async (tx) => {
      const archived = await this.nodeKinds.setArchived(tx, id, true);
      if (!archived) throw DomainException.notFound('Node kind not found');
      return archived;
    });
  }

  @Post('projects/node-kinds/:id/restore')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'project.node_kind_restore', entity: 'node_kind' })
  @ApiParam({ name: 'id', description: 'UUID вида', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Вернуть вид уровня из архива' })
  @ApiOkResponse({ standardSchema: nodeKindSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  nodeKindRestore(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
  ): Promise<NodeKind> {
    return this.txRunner.run(async (tx) => {
      const restored = await this.nodeKinds.setArchived(tx, id, false);
      if (!restored) throw DomainException.notFound('Node kind not found');
      return restored;
    });
  }
}
