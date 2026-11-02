import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
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
  batchCreateProjectNodesBodySchema,
  batchCreateProjectNodesResponseSchema,
  createProjectNodeBodySchema,
  moveProjectNodeBodySchema,
  projectNodeSchema,
  projectStructureResponseSchema,
  updateProjectNodeBodySchema,
  type AuthUser,
  type BatchCreateProjectNodesBody,
  type BatchCreateProjectNodesResponse,
  type CreateProjectNodeBody,
  type MoveProjectNodeBody,
  type ProjectNode,
  type ProjectStructureResponse,
  type UpdateProjectNodeBody,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { ProjectStructureMoveService } from './project-structure-move.service.js';
import { ProjectStructureService } from './project-structure.service.js';

const idParamSchema = z.uuid();
const nodeIdParamSchema = z.uuid();

/**
 * Дерево проекта (`/api/v1/projects/:id/…`, #467, ADR-0030 «Дополнение»):
 * узлы-папки со свободной вложенностью, задачи — листья. Чтение — доступ
 * просмотра проекта (как карточка); мутации — руководство проекта или
 * `project.manage` (сервис), архив — заморозка. Модуль за фичефлагом
 * `projects` (I10). Срез узлов — без курсора (≤1000, исключение ADR-0030).
 */
@ApiTags('projects')
@ApiBearerAuth()
@RequireFeature('projects')
@Controller('projects/:id')
export class ProjectStructureController {
  constructor(
    private readonly structure: ProjectStructureService,
    private readonly moves: ProjectStructureMoveService,
  ) {}

  @Get('structure')
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary: 'Структура проекта: узлы (плоско, по порядку) + агрегаты задач + виды уровней',
  })
  @ApiOkResponse({ standardSchema: projectStructureResponseSchema })
  @ApiErrors(400, 401, 404)
  get(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() user: AuthUser,
  ): Promise<ProjectStructureResponse> {
    return this.structure.structure(user, id);
  }

  @Post('nodes')
  @Audit({ action: 'project.node_create', entity: 'project_node' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Создать узел структуры (руководство проекта или project.manage)' })
  @ApiCreatedResponse({ standardSchema: projectNodeSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  create(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: createProjectNodeBodySchema,
      pipes: [new ZodValidationPipe(createProjectNodeBodySchema)],
    })
    dto: CreateProjectNodeBody,
    @GetUser() user: AuthUser,
  ): Promise<ProjectNode> {
    return this.structure.create(user, id, dto);
  }

  @Post('nodes/batch')
  @Audit({ action: 'project.node_batch_create', entity: 'project_node' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Пакетное создание узлов («Здания: поз. 1–3», ≤50 имён)' })
  @ApiCreatedResponse({ standardSchema: batchCreateProjectNodesResponseSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  createBatch(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: batchCreateProjectNodesBodySchema,
      pipes: [new ZodValidationPipe(batchCreateProjectNodesBodySchema)],
    })
    dto: BatchCreateProjectNodesBody,
    @GetUser() user: AuthUser,
  ): Promise<BatchCreateProjectNodesResponse> {
    return this.structure
      .createMany(user, id, {
        parentId: dto.parentId ?? null,
        kindId: dto.kindId,
        names: dto.names,
      })
      .then((nodes) => ({ nodes }));
  }

  @Patch('nodes/:nodeId')
  @Audit({ action: 'project.node_update', entity: 'project_node' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({
    name: 'nodeId',
    description: 'UUID узла',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({ summary: 'Правка узла: имя, шифр (null — очистить), вид-ярлык' })
  @ApiOkResponse({ standardSchema: projectNodeSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  update(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('nodeId', new ZodValidationPipe(nodeIdParamSchema)) nodeId: string,
    @Body({
      schema: updateProjectNodeBodySchema,
      pipes: [new ZodValidationPipe(updateProjectNodeBodySchema)],
    })
    dto: UpdateProjectNodeBody,
    @GetUser() user: AuthUser,
  ): Promise<ProjectNode> {
    return this.structure.update(user, id, nodeId, dto);
  }

  @Post('nodes/:nodeId/move')
  @HttpCode(200)
  @Audit({ action: 'project.node_move', entity: 'project_node' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({
    name: 'nodeId',
    description: 'UUID узла',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({
    summary: 'Перенос узла: родитель (null — корень) + якорь позиции (beforeId/afterId)',
  })
  @ApiOkResponse({ standardSchema: projectNodeSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  move(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('nodeId', new ZodValidationPipe(nodeIdParamSchema)) nodeId: string,
    @Body({
      schema: moveProjectNodeBodySchema,
      pipes: [new ZodValidationPipe(moveProjectNodeBodySchema)],
    })
    dto: MoveProjectNodeBody,
    @GetUser() user: AuthUser,
  ): Promise<ProjectNode> {
    return this.moves.move(user, id, nodeId, dto);
  }

  @Delete('nodes/:nodeId')
  @HttpCode(204)
  @Audit({ action: 'project.node_delete', entity: 'project_node' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({
    name: 'nodeId',
    description: 'UUID узла',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({
    summary: 'Удалить ПУСТОЙ узел (в нём задачи или дети — 409; архивации узлов нет)',
  })
  @ApiNoContentResponse()
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  remove(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('nodeId', new ZodValidationPipe(nodeIdParamSchema)) nodeId: string,
    @GetUser() user: AuthUser,
  ): Promise<void> {
    return this.structure.remove(user, id, nodeId);
  }
}
