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
  Permission,
  createProjectBodySchema,
  cursorQuerySchema,
  formulaBodySchema,
  formulaResponseSchema,
  listProjectsQuerySchema,
  paginatedSchema,
  projectDetailSchema,
  projectHistoryEntrySchema,
  projectListItemSchema,
  projectSecretPreviewSchema,
  projectStatusBodySchema,
  projectTransferBodySchema,
  updateProjectBodySchema,
  type AuthUser,
  type CreateProjectBody,
  type CursorQuery,
  type FormulaBody,
  type FormulaResponse,
  type ListProjectsQuery,
  type Paginated,
  type ProjectDetail,
  type ProjectHistoryEntry,
  type ProjectListItem,
  type ProjectSecretPreview,
  type ProjectStatusBody,
  type ProjectTransferBody,
  type UpdateProjectBody,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { ProjectLifecycleService } from './project-lifecycle.service.js';
import { ProjectFormulaService } from './project-formula.service.js';
import { ProjectsQueryService } from './projects-query.service.js';
import { ProjectsService } from './projects.service.js';

const idParamSchema = z.uuid();

/**
 * Журнал и карточка проектов (`/api/v1/projects`, #52, ADR-0030). Чтение —
 * фильтр видимости в сервисе (открытые всем, секретные — участию и
 * view_secret); создание — `project.create` (у всех ролей); правка полей и
 * статусы — руководство проекта или `project.manage` в сервисе; передача
 * руководства — только действующий руководитель. Модуль за фичефлагом
 * `projects` (I10).
 */
@ApiTags('projects')
@ApiBearerAuth()
@RequireFeature('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly queries: ProjectsQueryService,
    private readonly projects: ProjectsService,
    private readonly lifecycle: ProjectLifecycleService,
    private readonly formulas: ProjectFormulaService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Журнал проектов (фильтры: портфель, моя роль, видимость, статус, поиск)',
  })
  @ApiOkResponse({ standardSchema: paginatedSchema(projectListItemSchema) })
  @ApiErrors(400, 401)
  list(
    @Query({
      schema: listProjectsQuerySchema,
      pipes: [new ZodValidationPipe(listProjectsQuerySchema)],
    })
    query: ListProjectsQuery,
    @GetUser() user: AuthUser,
  ): Promise<Paginated<ProjectListItem>> {
    return this.queries.list(user, query);
  }

  @Post()
  @RequirePermissions(Permission.PROJECT_CREATE)
  @Audit({ action: 'project.create', entity: 'project' })
  @ApiOperation({
    summary: 'Создание проекта-договора или «темы» (руководитель по умолчанию — создатель)',
  })
  @ApiCreatedResponse({ standardSchema: projectDetailSchema })
  @ApiErrors(400, 401, 403, 409, 422)
  @ApiIdempotencyKey()
  create(
    @Body({
      schema: createProjectBodySchema,
      pipes: [new ZodValidationPipe(createProjectBodySchema)],
    })
    dto: CreateProjectBody,
    @GetUser() user: AuthUser,
  ): Promise<ProjectDetail> {
    return this.projects.create(user, dto);
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Карточка проекта (секретный не-участнику — 404)' })
  @ApiOkResponse({ standardSchema: projectDetailSchema })
  @ApiErrors(400, 401, 404)
  detail(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() user: AuthUser,
  ): Promise<ProjectDetail> {
    return this.queries.detail(user, id);
  }

  @Get(':id/secret-preview')
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary: 'Превью перевода в секретный: кто останется участником, кто потеряет доступ',
  })
  @ApiOkResponse({ standardSchema: projectSecretPreviewSchema })
  @ApiErrors(400, 401, 403, 404)
  secretPreview(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() user: AuthUser,
  ): Promise<ProjectSecretPreview> {
    return this.projects.secretPreview(user, id);
  }

  @Get(':id/custom-fields/:fieldId/formula')
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Эффективная формула ячейки атрибута проекта (своя или типа)' })
  @ApiOkResponse({ standardSchema: formulaResponseSchema })
  @ApiErrors(400, 401, 404)
  formula(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('fieldId', new ZodValidationPipe(idParamSchema)) fieldId: string,
    @GetUser() user: AuthUser,
  ): Promise<FormulaResponse> {
    return this.formulas.read(user, id, fieldId);
  }

  @Put(':id/custom-fields/:fieldId/formula')
  @HttpCode(200)
  @Audit({ action: 'custom_field.formula_set', entity: 'project' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Поставить формулу в ячейку атрибута проекта' })
  @ApiOkResponse({ standardSchema: formulaResponseSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  setFormula(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('fieldId', new ZodValidationPipe(idParamSchema)) fieldId: string,
    @Body({ schema: formulaBodySchema, pipes: [new ZodValidationPipe(formulaBodySchema)] })
    body: FormulaBody,
    @GetUser() user: AuthUser,
  ): Promise<FormulaResponse> {
    return this.formulas.save(user, id, fieldId, body.ast);
  }

  @Delete(':id/custom-fields/:fieldId/formula')
  @HttpCode(204)
  @Audit({ action: 'custom_field.formula_remove', entity: 'project' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary: 'Снять формулу проекта (значение очищается; ячейка пуста или под формулой типа)',
  })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  removeFormula(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('fieldId', new ZodValidationPipe(idParamSchema)) fieldId: string,
    @GetUser() user: AuthUser,
  ): Promise<void> {
    return this.formulas.remove(user, id, fieldId);
  }

  @Get(':id/history')
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary: 'История проекта (вкладка «История»): outbox-события агрегата, новые первыми',
  })
  @ApiOkResponse({ standardSchema: paginatedSchema(projectHistoryEntrySchema) })
  @ApiErrors(400, 401, 404)
  history(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Query({ schema: cursorQuerySchema, pipes: [new ZodValidationPipe(cursorQuerySchema)] })
    query: CursorQuery,
    @GetUser() user: AuthUser,
  ): Promise<Paginated<ProjectHistoryEntry>> {
    return this.queries.history(user, id, query.cursor ?? null, query.limit);
  }

  @Patch(':id')
  @Audit({ action: 'project.update', entity: 'project' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary: 'Правка полей (руководство проекта или project.manage; сервис проверяет)',
  })
  @ApiOkResponse({ standardSchema: projectDetailSchema })
  @ApiErrors(400, 401, 403, 404, 409, 422)
  @ApiIdempotencyKey()
  update(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: updateProjectBodySchema,
      pipes: [new ZodValidationPipe(updateProjectBodySchema)],
    })
    dto: UpdateProjectBody,
    @GetUser() user: AuthUser,
  ): Promise<ProjectDetail> {
    return this.projects.update(user, id, dto);
  }

  @Post(':id/status')
  @HttpCode(200)
  @Audit({ action: 'project.status', entity: 'project' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary: 'Статусные действия: завершение — метка, архив — заморозка, возврат — руководитель',
  })
  @ApiOkResponse({ standardSchema: projectDetailSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  setStatus(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: projectStatusBodySchema,
      pipes: [new ZodValidationPipe(projectStatusBodySchema)],
    })
    dto: ProjectStatusBody,
    @GetUser() user: AuthUser,
  ): Promise<ProjectDetail> {
    return this.lifecycle.setStatus(user, id, dto.status);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  @Audit({ action: 'project.transfer', entity: 'project' })
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary:
      'Передача руководства (только действующий руководитель; прежний без источников — наблюдатель-создатель)',
  })
  @ApiOkResponse({ standardSchema: projectDetailSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  transfer(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: projectTransferBodySchema,
      pipes: [new ZodValidationPipe(projectTransferBodySchema)],
    })
    dto: ProjectTransferBody,
    @GetUser() user: AuthUser,
  ): Promise<ProjectDetail> {
    return this.lifecycle.transfer(user, id, dto.managerId);
  }
}
