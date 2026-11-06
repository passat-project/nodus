import { Inject, Injectable } from '@nestjs/common';
import type {
  AuthUser,
  CustomFieldType,
  FormulaCellError,
  FormulaEvaluateResponse,
  FormulaHostKind,
  FormulaNode,
  FormulaValidateResponse,
  FormulaValidationIssue,
} from '@nodus/contracts';
import { ErrorCode, FORMULA_LIMITS } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { FORMULA_ENGINE, type FormulaEngine } from '../ports/formula-engine.port.js';
import { FormulaContextService } from './formula-context.service.js';
import { FormulaMetaService } from './formula-meta.service.js';

/**
 * Вычислительно-справочный контур формул (#632, Р10): проверка AST и
 * превью без записи. Живёт в custom-fields (мутации ячейки — у владельца
 * хоста, I3). Доступ к контексту evaluate обязателен: невидимый хост —
 * 404 без оракула (Р7).
 */
@Injectable()
export class FormulaApiService {
  constructor(
    private readonly meta: FormulaMetaService,
    private readonly context: FormulaContextService,
    @Inject(FORMULA_ENGINE) private readonly engine: FormulaEngine,
  ) {}

  async validate(body: {
    ast: FormulaNode;
    hostKind: FormulaHostKind;
    targetFieldId?: string;
    targetType?: CustomFieldType;
    typeDefault?: boolean;
  }): Promise<FormulaValidateResponse> {
    const snapshot = await this.meta.snapshot();
    let targetFieldType = body.targetType;
    if (body.targetFieldId) {
      const definition = snapshot.byId.get(body.targetFieldId);
      if (!definition) throw DomainException.notFound('Custom field not found');
      targetFieldType = definition.type as CustomFieldType;
    }
    const result = this.engine.validate(body.ast, {
      hostKind: body.hostKind,
      meta: snapshot.meta,
      ...(targetFieldType ? { targetFieldType } : {}),
      ...(body.typeDefault ? { typeDefault: true } : {}),
    });
    return {
      ok: result.ok,
      type: result.type,
      issues: result.issues.map((issue) => toContractIssue(issue)),
    };
  }

  async evaluate(
    body: { ast: FormulaNode; context: { hostKind: FormulaHostKind; hostId: string } },
    actor: AuthUser,
  ): Promise<FormulaEvaluateResponse> {
    const snapshot = await this.meta.snapshot();
    // Форма AST (лимиты, матрица источников) проверяется и в превью:
    // иначе evaluate обходил бы запреты матрицы и лимиты языка (Р2/Р7).
    const shape = this.engine.validate(body.ast, {
      hostKind: body.context.hostKind,
      meta: snapshot.meta,
    });
    const blocking = shape.issues.filter((issue) => issue.blocking);
    if (blocking.length > 0) {
      throw new DomainException(formulaErrorCodeOf(blocking[0]!.code), 'Formula is invalid', {
        issues: blocking,
      });
    }
    const context = await this.context.build({
      hostKind: body.context.hostKind,
      hostId: body.context.hostId,
      asts: [body.ast],
      snapshot,
      actor,
    });
    if (!context) throw DomainException.notFound('Formula host not found');
    if (context.overflowed) {
      return {
        value: null,
        error: {
          code: 'selection_limit',
          message: `aggregate selection exceeds ${FORMULA_LIMITS.selection} records`,
        } satisfies FormulaCellError,
      };
    }
    const evaluation = this.engine.evaluate(body.ast, context.resolver);
    return {
      value: evaluation.value as FormulaEvaluateResponse['value'],
      error: evaluation.error,
    };
  }
}

/** Проблема движка → контракт (коды совпадают, добавляем blocking). */
function toContractIssue(issue: {
  code: string;
  path: string;
  message: string;
  number?: number;
  blocking: boolean;
}): FormulaValidationIssue {
  return {
    code: issue.code,
    path: issue.path,
    message: issue.message,
    ...(issue.number === undefined ? {} : { number: issue.number }),
    blocking: issue.blocking,
  };
}

/** Код отказа API по блокирующей проблеме (для эндпоинтов владельцев). */
export function formulaErrorCodeOf(code: string): ErrorCode {
  switch (code) {
    case 'type_mismatch':
      return ErrorCode.FORMULA_TYPE_MISMATCH;
    case 'source_forbidden':
    case 'selector_forbidden':
      return ErrorCode.FORMULA_SOURCE_FORBIDDEN;
    case 'depth':
    case 'nodes':
    case 'sources':
    case 'literal_text':
      return ErrorCode.FORMULA_LIMIT_EXCEEDED;
    default:
      return ErrorCode.FORMULA_AST_INVALID;
  }
}
