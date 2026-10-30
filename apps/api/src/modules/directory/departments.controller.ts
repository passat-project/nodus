import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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
  departmentNodeSchema,
  type AuthUser,
  createDepartmentSchema,
  orgUnitKindSchema,
  Permission,
  updateDepartmentSchema,
  type CreateDepartmentDto,
  type DepartmentNode,
  type OrgUnitKind,
  type UpdateDepartmentDto,
} from '@nodus/contracts';

import { Audit } from '../../core/decorators/audit.decorator.js';
import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequirePermissions } from '../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { DepartmentsService } from './departments.service.js';

const treeQuerySchema = z.object({
  kind: orgUnitKindSchema.default('management'),
});

/** Оргструктура (`/api/v1/directory/departments`): дерево, CRUD, архивация. */
@ApiTags('directory')
@ApiBearerAuth()
@Controller('directory/departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get('tree')
  @RequirePermissions(Permission.DIRECTORY_READ)
  @ApiOperation({ summary: 'Дерево оргструктуры (управленческое или юридическое)' })
  @ApiOkResponse({ standardSchema: departmentNodeSchema, isArray: true })
  @ApiErrors(400, 401, 403)
  tree(
    @Query({ schema: treeQuerySchema, pipes: [new ZodValidationPipe(treeQuerySchema)] })
    query: {
      kind: OrgUnitKind;
    },
  ): Promise<DepartmentNode[]> {
    return this.departmentsService.getTree(query.kind);
  }

  @Get(':id')
  @RequirePermissions(Permission.DIRECTORY_READ)
  @ApiOperation({ summary: 'Подразделение по идентификатору' })
  @ApiParam({
    name: 'id',
    description: 'UUID подразделения',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: departmentNodeSchema })
  @ApiErrors(401, 403, 404)
  getById(@Param('id') id: string): Promise<DepartmentNode> {
    return this.departmentsService.getById(id);
  }

  @Post()
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.department.create', entity: 'department' })
  @ApiOperation({ summary: 'Создание подразделения' })
  @ApiCreatedResponse({ standardSchema: departmentNodeSchema })
  @ApiErrors(400, 401, 403, 409)
  @ApiIdempotencyKey()
  create(
    @Body({
      schema: createDepartmentSchema,
      pipes: [new ZodValidationPipe(createDepartmentSchema)],
    })
    dto: CreateDepartmentDto,
    @GetUser() actor: AuthUser,
  ): Promise<DepartmentNode> {
    return this.departmentsService.create(dto, actor.id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.department.update', entity: 'department' })
  @ApiOperation({ summary: 'Обновление подразделения' })
  @ApiParam({
    name: 'id',
    description: 'UUID подразделения',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: departmentNodeSchema })
  @ApiErrors(400, 401, 403, 404, 409)
  update(
    @Param('id') id: string,
    @Body({
      schema: updateDepartmentSchema,
      pipes: [new ZodValidationPipe(updateDepartmentSchema)],
    })
    dto: UpdateDepartmentDto,
    @GetUser() actor: AuthUser,
  ): Promise<DepartmentNode> {
    return this.departmentsService.update(id, dto, actor);
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequirePermissions(Permission.DIRECTORY_MANAGE)
  @Audit({ action: 'directory.department.archive', entity: 'department' })
  @ApiOperation({ summary: 'Архивация подразделения (без удаления, I15)' })
  @ApiParam({
    name: 'id',
    description: 'UUID подразделения',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiNoContentResponse({ description: 'Подразделение архивировано' })
  @ApiErrors(401, 403, 404, 409)
  @ApiIdempotencyKey()
  archive(@Param('id') id: string, @GetUser() actor: AuthUser): Promise<void> {
    return this.departmentsService.archive(id, actor.id);
  }
}
