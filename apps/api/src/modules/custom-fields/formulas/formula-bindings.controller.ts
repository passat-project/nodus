import { Body, Controller, Delete, HttpCode, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser, CustomFieldDefinition, FormulaBody } from '@nodus/contracts';
import { customFieldDefinitionSchema, formulaBodySchema, Permission } from '@nodus/contracts';

import { Audit } from '../../../core/decorators/audit.decorator.js';
import { GetUser } from '../../../core/decorators/get-user.decorator.js';
import { RequirePermissions } from '../../../core/decorators/require-permissions.decorator.js';
import { ApiErrors } from '../../../core/openapi/api-errors.decorator.js';
import { ApiIdempotencyKey } from '../../../core/openapi/api-idempotency.decorator.js';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe.js';
import { FormulaBindingService } from './formula-binding.service.js';

const idParamSchema = z.uuid();
const targetIdParamSchema = z.uuid();

/**
 * Формула места (#632, Р6): «Атрибуты» → карточка атрибута → «Где
 * используется» → калькулятор у отмеченного типа/вида. У каждого места своя
 * формула; вычисляется на чтении, значения записей не переписываются.
 */
@ApiTags('custom-fields')
@ApiBearerAuth()
@Controller('custom-fields/definitions')
export class FormulaBindingsController {
  constructor(private readonly formulas: FormulaBindingService) {}

  @Put(':id/binding-formulas/:targetId')
  @HttpCode(200)
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @Audit({ action: 'custom_field.formula_binding_set', entity: 'field_definition' })
  @ApiOperation({ summary: 'Поставить формулу на привязку «атрибут × тип/вид»' })
  @ApiParam({
    name: 'id',
    description: 'UUID атрибута',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiParam({
    name: 'targetId',
    description: 'UUID цели привязки (тип процесса/проекта или вид папки)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: customFieldDefinitionSchema })
  @ApiErrors(400, 401, 403, 404, 422)
  @ApiIdempotencyKey()
  set(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('targetId', new ZodValidationPipe(targetIdParamSchema)) targetId: string,
    @Body({
      schema: formulaBodySchema,
      pipes: [new ZodValidationPipe(formulaBodySchema)],
    })
    body: FormulaBody,
    @GetUser() actor: AuthUser,
  ): Promise<CustomFieldDefinition> {
    return this.formulas.setFormula(id, targetId, body.ast, actor.id);
  }

  @Delete(':id/binding-formulas/:targetId')
  @HttpCode(200)
  @RequirePermissions(Permission.CUSTOM_FIELD_MANAGE)
  @Audit({ action: 'custom_field.formula_binding_remove', entity: 'field_definition' })
  @ApiOperation({ summary: 'Снять формулу с привязки (значения записей не меняются)' })
  @ApiParam({
    name: 'id',
    description: 'UUID атрибута',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiParam({
    name: 'targetId',
    description: 'UUID цели привязки (тип процесса/проекта или вид папки)',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ standardSchema: customFieldDefinitionSchema })
  @ApiErrors(400, 401, 403, 404)
  @ApiIdempotencyKey()
  remove(
    @Param('id', new ZodValidationPipe(idParamSchema)) id: string,
    @Param('targetId', new ZodValidationPipe(targetIdParamSchema)) targetId: string,
    @GetUser() actor: AuthUser,
  ): Promise<CustomFieldDefinition> {
    return this.formulas.removeFormula(id, targetId, actor.id);
  }
}
