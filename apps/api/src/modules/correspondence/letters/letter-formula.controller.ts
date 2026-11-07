import { Body, Controller, Delete, Get, HttpCode, Param, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  formulaBodySchema,
  formulaResponseSchema,
  type AuthUser,
  type FormulaBody,
  type FormulaResponse,
} from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequireFeature } from '../../../core/decorators/require-feature.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { LetterFormulaService } from './letter-formula.service.js';

const uuid = new ZodValidationPipe(z.uuid());

/**
 * Формула ячейки атрибута письма (#632, Р10): мутации живут у ВЛАДЕЛЬЦА хоста
 * (I3) — право правки проверяется в сервисе (`canEdit` письма, канцелярия),
 * значение материализует штатный писатель письма. Отдельный контроллер, а не
 * маршруты `LettersController`: карточка писем уже на пределе размера файла,
 * а у связей письма (#461) такой же отдельный контроллер — паттерн модуля.
 */
@ApiTags('correspondence')
@ApiBearerAuth()
@RequireFeature('correspondence')
@Controller('letters')
export class LetterFormulaController {
  constructor(private readonly formulas: LetterFormulaService) {}

  @Get(':id/custom-fields/:fieldId/formula')
  @ApiOperation({ summary: 'Эффективная формула ячейки атрибута письма (своя или типа)' })
  @ApiOkResponse({ standardSchema: formulaResponseSchema })
  @ApiErrors(400, 401, 404)
  formula(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('fieldId', uuid) fieldId: string,
  ): Promise<FormulaResponse> {
    return this.formulas.read(user, id, fieldId);
  }

  @Put(':id/custom-fields/:fieldId/formula')
  @HttpCode(200)
  @Audit({ action: 'custom_field.formula_set', entity: 'letter' })
  @ApiOperation({ summary: 'Поставить формулу в ячейку атрибута письма' })
  @ApiOkResponse({ standardSchema: formulaResponseSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  setFormula(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('fieldId', uuid) fieldId: string,
    @Body({ schema: formulaBodySchema, pipes: [new ZodValidationPipe(formulaBodySchema)] })
    body: FormulaBody,
  ): Promise<FormulaResponse> {
    return this.formulas.save(user, id, fieldId, body.ast);
  }

  @Delete(':id/custom-fields/:fieldId/formula')
  @HttpCode(204)
  @Audit({ action: 'custom_field.formula_remove', entity: 'letter' })
  @ApiOperation({ summary: 'Снять формулу ячейки письма (значение-снимок остаётся)' })
  @ApiNoContentResponse()
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  removeFormula(
    @GetUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('fieldId', uuid) fieldId: string,
  ): Promise<void> {
    return this.formulas.remove(user, id, fieldId);
  }
}
