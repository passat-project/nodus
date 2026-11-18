import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  searchRequestSchema,
  searchResponseSchema,
  type AuthUser,
  type SearchRequest,
  type SearchResponse,
} from '@nodus/contracts';

import { GetUser } from '../../core/decorators/get-user.decorator.js';
import { ApiErrors } from '../../core/openapi/api-errors.decorator.js';
import { ZodValidationPipe } from '../../core/pipes/zod-validation.pipe.js';
import { SearchService } from './search.service.js';

/**
 * Единый поиск по порталу (#952): `GET /api/v1/search`. Маршрут без
 * `@RequirePermissions` осознанно — доступ фильтруется видимостью каждого
 * источника в сервисе (pre-filter портами задач/чатов/проектов + формула
 * письма), запись в `rbac-inventory.reasons.ts`. Только чтение: идемпотентен
 * по природе, `Idempotency-Key` не нужен.
 */
@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Поиск по порталу: задачи, письма, сообщения, проекты, сотрудники' })
  @ApiOkResponse({ standardSchema: searchResponseSchema })
  @ApiErrors(400, 401, 504)
  find(
    @GetUser() user: AuthUser,
    @Query({ schema: searchRequestSchema, pipes: [new ZodValidationPipe(searchRequestSchema)] })
    query: SearchRequest,
  ): Promise<SearchResponse> {
    return this.search.search(user, query);
  }
}
