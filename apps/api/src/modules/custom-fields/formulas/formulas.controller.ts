import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AuthUser,
  FormulaEvaluateBody,
  FormulaEvaluateResponse,
  FormulaValidateBody,
  FormulaValidateResponse,
} from '@nodus/contracts';
import { formulaEvaluateBodySchema, formulaValidateBodySchema } from '@nodus/contracts';

import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { FormulaApiService } from './formula-api.service.js';

/**
 * Вычислительно-справочный контур формул (#632, Р10): проверка AST и
 * превью без записи. Мутации формулы ячейки живут у владельца хоста (I3),
 * здесь — только то, что нужно редактору формул на каждой клавише.
 */
@ApiTags('custom-fields')
@ApiBearerAuth()
@Controller('custom-fields/formulas')
export class FormulasController {
  constructor(private readonly formulas: FormulaApiService) {}

  @Post('validate')
  @ApiOperation({ summary: 'Проверить формулу: тайпинг, источники, лимиты (без записи)' })
  @ApiOkResponse({ description: 'Результат проверки: ok, выведенный тип, проблемы' })
  @ApiErrors(400, 401, 404, 422)
  validate(
    @Body({
      schema: formulaValidateBodySchema,
      pipes: [new ZodValidationPipe(formulaValidateBodySchema)],
    })
    body: FormulaValidateBody,
  ): Promise<FormulaValidateResponse> {
    return this.formulas.validate(body);
  }

  @Post('evaluate')
  @ApiOperation({ summary: 'Вычислить формулу в контексте записи (превью/префилл)' })
  @ApiOkResponse({ description: 'Значение формулы или ошибка ячейки' })
  @ApiErrors(400, 401, 404, 422)
  evaluate(
    @Body({
      schema: formulaEvaluateBodySchema,
      pipes: [new ZodValidationPipe(formulaEvaluateBodySchema)],
    })
    body: FormulaEvaluateBody,
    @GetUser() actor: AuthUser,
  ): Promise<FormulaEvaluateResponse> {
    return this.formulas.evaluate(body, actor);
  }
}
