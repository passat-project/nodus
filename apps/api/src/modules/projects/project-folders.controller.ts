import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  folderListItemSchema,
  listFoldersQuerySchema,
  listResultSchema,
  type AuthUser,
  type FolderListItem,
  type ListFoldersQuery,
  type ListResult,
} from '@nodus/contracts';

import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../core/decorators/require-feature.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { ProjectFoldersService } from './project-folders.service.js';

/**
 * Список папок проекта (`/api/v1/projects/:id/folders`, #435): вкладка-список
 * «папки» с расширением — фильтр по атрибутам вида, сортировка, группировка,
 * итоги, курсор. Рамка проекта — путь, видимость проекта — как у структуры.
 * Модуль за флагом `projects` (I10).
 */
@ApiTags('projects')
@ApiBearerAuth()
@RequireFeature('projects')
@Controller('projects/:id/folders')
export class ProjectFoldersController {
  constructor(private readonly folders: ProjectFoldersService) {}

  @Get()
  @ApiParam({ name: 'id', description: 'UUID проекта', schema: { type: 'string', format: 'uuid' } })
  @ApiOperation({
    summary:
      'Список папок проекта с расширением (?filter/&sort/&group/&totals — JSON; курсор; рамка проекта не снимается)',
  })
  @ApiOkResponse({ standardSchema: listResultSchema(folderListItemSchema) })
  @ApiErrors(400, 401, 404, 422)
  list(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @GetUser() user: AuthUser,
    @Query({
      schema: listFoldersQuerySchema,
      pipes: [new ZodValidationPipe(listFoldersQuerySchema)],
    })
    q: ListFoldersQuery,
  ): Promise<ListResult<FolderListItem>> {
    return this.folders.list(user, id, q);
  }
}
