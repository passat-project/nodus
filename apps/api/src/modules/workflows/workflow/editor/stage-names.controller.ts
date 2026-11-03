import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  workflowStageNamesQuerySchema,
  workflowStageNamesSchema,
  type WorkflowStageName,
  type WorkflowStageNamesQuery,
} from '@nodus/contracts';

import { RequirePermissions } from '../../../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../../../core/openapi/api-errors.decorator.js';
import { ZodValidationPipe } from '../../../../core/pipes/zod-validation.pipe.js';
import { WorkflowStageNamesService } from './stage-names.service.js';

/**
 * Подсказки имён статусов (#430): только настройщикам процессов — это часть
 * редактора, а не публичный справочник. Входят системный каталог (по `code`)
 * и опубликованные пользовательские маршруты; черновики без `code` — нет.
 */
@ApiTags('workflows')
@ApiBearerAuth()
@Controller('workflows')
export class WorkflowStageNamesController {
  constructor(private readonly names: WorkflowStageNamesService) {}

  @Get('stage-names')
  @RequirePermissions(Permission.WORKFLOW_MANAGE)
  @ApiOperation({ summary: 'Имена статусов опубликованных маршрутов для подсказок' })
  @ApiOkResponse({ standardSchema: workflowStageNamesSchema })
  @ApiErrors(400, 401, 403)
  list(
    @Query({
      schema: workflowStageNamesQuerySchema,
      pipes: [new ZodValidationPipe(workflowStageNamesQuerySchema)],
    })
    query: WorkflowStageNamesQuery,
  ): Promise<WorkflowStageName[]> {
    return this.names.list(query);
  }
}
