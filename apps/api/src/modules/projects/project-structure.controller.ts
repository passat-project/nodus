import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
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
  formulaBodySchema,
  formulaMovePreviewResponseSchema,
  formulaResponseSchema,
  moveProjectNodeBodySchema,
  projectNodeSchema,
  projectStructureResponseSchema,
  updateProjectNodeBodySchema,
  type AuthUser,
  type BatchCreateProjectNodesBody,
  type BatchCreateProjectNodesResponse,
  type CreateProjectNodeBody,
  type FormulaBody,
  type FormulaMovePreviewResponse,
  type FormulaResponse,
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
import { ProjectFormulaService } from './project-formula.service.js';
import { ProjectStructureMoveService } from './project-structure-move.service.js';
import { ProjectStructureService } from './project-structure.service.js';

const idParamSchema = z.uuid();
const nodeIdParamSchema = z.uuid();
/** Тело dry-run переноса (#632, Р10): только новый родитель (`null` — корень);
 *  якоря позиции (beforeId/afterId) на формулы не влияют. */
const movePreviewBodySchema = z.object({ parentId: z.uuid().nullable() }).strict();
type MovePreviewBody = z.infer<typeof movePreviewBodySchema>;

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
    private readonly formulas: ProjectFormulaService,
  ) {}

  @Get('structure')
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary: 'Структура проекта: папки (плоско, по порядку) + агрегаты задач + виды папок',
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
  @ApiOperation({ summary: 'Создать папку структуры (руководство проекта или project.manage)' })
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
  @ApiOperation({
    summary: 'Пакетное создание папок («Здания: поз. 1–3», ≤50 имён, общие значения)',
  })
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
        customFields: dto.customFields,
        confirmEmptyNumberParts: dto.confirmEmptyNumberParts,
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
  @ApiOperation({ summary: 'Правка папки: имя, шифр (null — очистить), вид, значения атрибутов' })
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

  @Get('nodes/:nodeId/custom-fields/:fieldId/formula')
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({
    name: 'nodeId',
    description: 'UUID узла',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({ summary: 'Эффективная формула ячейки атрибута папки (своя или вида)' })
  @ApiOkResponse({ standardSchema: formulaResponseSchema })
  @ApiErrors(400, 401, 404, 422)
  nodeFormula(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('nodeId', new ZodValidationPipe(nodeIdParamSchema)) nodeId: string,
    @Param('fieldId', new ZodValidationPipe(nodeIdParamSchema)) fieldId: string,
    @GetUser() user: AuthUser,
  ): Promise<FormulaResponse> {
    return this.formulas.readNode(user, id, nodeId, fieldId);
  }

  @Put('nodes/:nodeId/custom-fields/:fieldId/formula')
  @HttpCode(200)
  @Audit({ action: 'custom_field.formula_set', entity: 'project_node' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({
    name: 'nodeId',
    description: 'UUID узла',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({ summary: 'Поставить формулу в ячейку атрибута папки' })
  @ApiOkResponse({ standardSchema: formulaResponseSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  setNodeFormula(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('nodeId', new ZodValidationPipe(nodeIdParamSchema)) nodeId: string,
    @Param('fieldId', new ZodValidationPipe(nodeIdParamSchema)) fieldId: string,
    @Body({ schema: formulaBodySchema, pipes: [new ZodValidationPipe(formulaBodySchema)] })
    body: FormulaBody,
    @GetUser() user: AuthUser,
  ): Promise<FormulaResponse> {
    return this.formulas.saveNode(user, id, nodeId, fieldId, body.ast);
  }

  @Delete('nodes/:nodeId/custom-fields/:fieldId/formula')
  @HttpCode(204)
  @Audit({ action: 'custom_field.formula_remove', entity: 'project_node' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({
    name: 'nodeId',
    description: 'UUID узла',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({
    summary: 'Снять формулу папки (значение очищается; ячейка пуста или под формулой вида)',
  })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  removeNodeFormula(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('nodeId', new ZodValidationPipe(nodeIdParamSchema)) nodeId: string,
    @Param('fieldId', new ZodValidationPipe(nodeIdParamSchema)) fieldId: string,
    @GetUser() user: AuthUser,
  ): Promise<void> {
    return this.formulas.removeNode(user, id, nodeId, fieldId);
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
    summary: 'Перенос папки: родитель (null — корень) + якорь позиции (beforeId/afterId)',
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

  @Post('nodes/:nodeId/move-preview')
  @HttpCode(200)
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiParam({
    name: 'nodeId',
    description: 'UUID узла',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({
    summary: 'Что изменится в формулах при переносе папки (dry-run, без записи)',
  })
  @ApiOkResponse({ standardSchema: formulaMovePreviewResponseSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  movePreview(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('nodeId', new ZodValidationPipe(nodeIdParamSchema)) nodeId: string,
    @Body({
      schema: movePreviewBodySchema,
      pipes: [new ZodValidationPipe(movePreviewBodySchema)],
    })
    dto: MovePreviewBody,
    @GetUser() user: AuthUser,
  ): Promise<FormulaMovePreviewResponse> {
    return this.formulas.movePreview(user, id, nodeId, dto.parentId);
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
    summary: 'Удалить ПУСТУЮ папку (в ней задачи или дети — 409; архивации папок нет)',
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
