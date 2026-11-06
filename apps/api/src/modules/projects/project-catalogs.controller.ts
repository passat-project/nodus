import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
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
  projectGroupCreateBodySchema,
  projectGroupSchema,
  projectGroupUpdateBodySchema,
  projectTypeCreateBodySchema,
  projectTypeSchema,
  projectTypeUpdateBodySchema,
  portalSettingsSchema,
  portalSettingsUpdateBodySchema,
  type AuthUser,
  type PortalSettings,
  type PortalSettingsUpdateBody,
  type ProjectGroup,
  type ProjectGroupCreateBody,
  type ProjectGroupUpdateBody,
  type ProjectType,
  type ProjectTypeCreateBody,
  type ProjectTypeUpdateBody,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { EventBus } from '../../core/events/event-bus.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../custom-fields/ports/custom-field-registry.port.js';
import { NodeKindsRepository } from './project-node-kinds.repository.js';
import { ProjectGroupsRepository } from './project-groups.repository.js';
import { ProjectTypesRepository } from './project-types.repository.js';
import { emitProjectTypeChanged } from './project-type-events.js';
import { createProjectType, updateProjectType } from './project-type-form.js';
import { ProjectsService } from './projects.service.js';

const idParamSchema = z.uuid();
const listQuerySchema = z.object({ includeArchived: z.enum(['true', 'false']).default('false') });

/**
 * Справочники модуля (#52): типы проектов (вкладка «Типы проектов»
 * «Автоматизации», право `project.setup.manage`), виды уровней структуры
 * (#467 — то же право), портфели (создание — `project.create`, архивация —
 * `project.manage`) и настройки портала (дефолт видимости новых проектов —
 * `project.setup.manage`, Р7). Статические маршруты (`projects/types`,
 * `projects/node-kinds`) фармуруются раньше параметрических `projects/:id`
 * — роутер Fastify отдаёт статике приоритет.
 */
@ApiTags('projects')
@ApiBearerAuth()
@RequireFeature('projects')
@Controller()
export class ProjectCatalogsController {
  constructor(
    private readonly types: ProjectTypesRepository,
    private readonly groups: ProjectGroupsRepository,
    private readonly nodeKinds: NodeKindsRepository,
    private readonly settings: ProjectsService,
    private readonly txRunner: TransactionRunner,
    private readonly eventBus: EventBus,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
  ) {}

  // ===== Типы проектов («Автоматизация», Р6) =====

  @Get('projects/types')
  @ApiOperation({ summary: 'Каталог типов проектов (живые; ?includeArchived=true — с архивом)' })
  @ApiOkResponse({ standardSchema: z.array(projectTypeSchema) })
  @ApiErrors(400, 401)
  typesList(
    @Query({ schema: listQuerySchema, pipes: [new ZodValidationPipe(listQuerySchema)] })
    query: {
      includeArchived: string;
    },
  ): Promise<ProjectType[]> {
    return this.types.list(query.includeArchived === 'true');
  }

  @Post('projects/types')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'project.type_create', entity: 'project_type' })
  @ApiOperation({ summary: 'Новый тип проекта (название, значок, цвет)' })
  @ApiCreatedResponse({ standardSchema: projectTypeSchema })
  @ApiErrors(400, 401, 403, 409)
  @ApiIdempotencyKey()
  typeCreate(
    @Body({
      schema: projectTypeCreateBodySchema,
      pipes: [new ZodValidationPipe(projectTypeCreateBodySchema)],
    })
    dto: ProjectTypeCreateBody,
    @GetUser() actor: AuthUser,
  ): Promise<ProjectType> {
    return this.txRunner.run((tx) =>
      createProjectType(
        { types: this.types, registry: this.customFields, eventBus: this.eventBus },
        tx,
        dto,
        actor.id,
      ),
    );
  }

  @Patch('projects/types/:id')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'project.type_update', entity: 'project_type' })
  @ApiParam({ name: 'id', description: 'UUID типа', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary: 'Правка типа проекта: имя, значок, цвет, форма атрибутов, виды папок',
  })
  @ApiOkResponse({ standardSchema: projectTypeSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  @ApiIdempotencyKey()
  typeUpdate(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: projectTypeUpdateBodySchema,
      pipes: [new ZodValidationPipe(projectTypeUpdateBodySchema)],
    })
    dto: ProjectTypeUpdateBody,
    @GetUser() actor: AuthUser,
  ): Promise<ProjectType> {
    return this.txRunner.run((tx) =>
      updateProjectType(
        {
          types: this.types,
          nodeKinds: this.nodeKinds,
          registry: this.customFields,
          eventBus: this.eventBus,
        },
        tx,
        id,
        dto,
        actor.id,
      ),
    );
  }

  @Delete('projects/types/:id')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'project.type_archive', entity: 'project_type' })
  @ApiParam({ name: 'id', description: 'UUID типа', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Архивировать тип (проекты сохраняют ссылку, состав не ломается)' })
  @ApiOkResponse({ standardSchema: projectTypeSchema })
  @ApiErrors(400, 401, 403, 404)
  typeArchive(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() actor: AuthUser,
  ): Promise<ProjectType> {
    return this.txRunner.run(async (tx) => {
      const archived = await this.types.setArchived(tx, id, true);
      if (!archived) throw DomainException.notFound('Project type not found');
      await emitProjectTypeChanged(this.eventBus, tx, id, 'archived', ['archivedAt'], actor.id);
      return archived;
    });
  }

  @Post('projects/types/:id/restore')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'project.type_restore', entity: 'project_type' })
  @ApiParam({ name: 'id', description: 'UUID типа', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({ summary: 'Вернуть тип из архива' })
  @ApiOkResponse({ standardSchema: projectTypeSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  typeRestore(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @GetUser() actor: AuthUser,
  ): Promise<ProjectType> {
    return this.txRunner.run(async (tx) => {
      const restored = await this.types.setArchived(tx, id, false);
      if (!restored) throw DomainException.notFound('Project type not found');
      await emitProjectTypeChanged(this.eventBus, tx, id, 'restored', ['archivedAt'], actor.id);
      return restored;
    });
  }

  // ===== Портфели (плоский список) =====

  @Get('projects/groups')
  @ApiOperation({ summary: 'Портфели (живые; ?includeArchived=true — с архивом)' })
  @ApiOkResponse({ standardSchema: z.array(projectGroupSchema) })
  @ApiErrors(400, 401)
  groupsList(
    @Query({ schema: listQuerySchema, pipes: [new ZodValidationPipe(listQuerySchema)] })
    query: {
      includeArchived: string;
    },
  ): Promise<ProjectGroup[]> {
    return this.groups.list(query.includeArchived === 'true');
  }

  @Post('projects/groups')
  @RequirePermissions(Permission.PROJECT_CREATE)
  @Audit({ action: 'project.group_create', entity: 'project_group' })
  @ApiOperation({ summary: 'Новый портфель' })
  @ApiCreatedResponse({ standardSchema: projectGroupSchema })
  @ApiErrors(400, 401, 403)
  @ApiIdempotencyKey()
  groupCreate(
    @Body({
      schema: projectGroupCreateBodySchema,
      pipes: [new ZodValidationPipe(projectGroupCreateBodySchema)],
    })
    dto: ProjectGroupCreateBody,
    @GetUser() user: AuthUser,
  ): Promise<ProjectGroup> {
    return this.txRunner.run((tx) => this.groups.create(tx, dto.name, user.id));
  }

  @Patch('projects/groups/:id')
  @RequirePermissions(Permission.PROJECT_MANAGE)
  @Audit({ action: 'project.group_update', entity: 'project_group' })
  @ApiParam({
    name: 'id',
    description: 'UUID портфеля',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({ summary: 'Переименовать портфель' })
  @ApiOkResponse({ standardSchema: projectGroupSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  groupRename(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Body({
      schema: projectGroupUpdateBodySchema,
      pipes: [new ZodValidationPipe(projectGroupUpdateBodySchema)],
    })
    dto: ProjectGroupUpdateBody,
  ): Promise<ProjectGroup> {
    return this.txRunner.run(async (tx) => {
      const renamed = await this.groups.rename(tx, id, dto.name ?? '');
      if (!renamed) throw DomainException.notFound('Portfolio not found');
      return renamed;
    });
  }

  @Delete('projects/groups/:id')
  @RequirePermissions(Permission.PROJECT_MANAGE)
  @Audit({ action: 'project.group_archive', entity: 'project_group' })
  @ApiParam({
    name: 'id',
    description: 'UUID портфеля',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOperation({ summary: 'Архивировать портфель (проекты сохраняются без него)' })
  @ApiOkResponse({ standardSchema: projectGroupSchema })
  @ApiErrors(400, 401, 403, 404)
  groupArchive(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
  ): Promise<ProjectGroup> {
    return this.txRunner.run(async (tx) => {
      const archived = await this.groups.setArchived(tx, id, true);
      if (!archived) throw DomainException.notFound('Portfolio not found');
      return archived;
    });
  }

  // ===== Настройки портала (Р7) =====

  @Get('settings/portal')
  @ApiOperation({ summary: 'Настройки портала (окну создания нужен дефолт видимости проектов)' })
  @ApiOkResponse({ standardSchema: portalSettingsSchema })
  @ApiErrors(400, 401)
  portalSettings(): Promise<PortalSettings> {
    return this.settings.defaultVisibility().then((defaultVisibility) => ({
      projects: { defaultVisibility },
    }));
  }

  @Put('settings/portal')
  @RequirePermissions(Permission.PROJECT_SETUP_MANAGE)
  @Audit({ action: 'settings.portal_update', entity: 'portal_settings' })
  @ApiOperation({ summary: 'Изменить настройки портала (право project.setup.manage)' })
  @ApiOkResponse({ standardSchema: portalSettingsSchema })
  @ApiErrors(400, 401, 403)
  @ApiIdempotencyKey()
  portalSettingsUpdate(
    @Body({
      schema: portalSettingsUpdateBodySchema,
      pipes: [new ZodValidationPipe(portalSettingsUpdateBodySchema)],
    })
    dto: PortalSettingsUpdateBody,
  ): Promise<PortalSettings> {
    return this.settings
      .putDefaultVisibility(dto.projects.defaultVisibility)
      .then(() => ({ projects: { defaultVisibility: dto.projects.defaultVisibility } }));
  }
}
