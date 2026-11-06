import { Inject, Injectable } from '@nestjs/common';
import type {
  AuthUser,
  CustomFieldType,
  FormulaCellError,
  FormulaEvaluateBody,
  FormulaEvaluateResponse,
  FormulaHostKind,
  FormulaNode,
  FormulaValidateResponse,
  FormulaValidationIssue,
} from '@nodus/contracts';
import { ErrorCode, FORMULA_LIMITS } from '@nodus/contracts';

import { DomainException } from '../../../core/errors/domain-exception.js';
import { FORMULA_ENGINE, type FormulaEngine } from '../ports/formula-engine.port.js';
import type { FormulaRecordData } from '../ports/record-values.port.js';
import { createFormulaCache, FormulaContextService } from './formula-context.service.js';
import { FormulaMetaService } from './formula-meta.service.js';

/**
 * Вычислительно-справочный контур формул (#632, Р10): проверка AST и
 * превью без записи. Живёт в custom-fields (мутации ячейки — у владельца
 * хоста, I3). Доступ к контексту evaluate обязателен: невидимый хост —
 * 404 без оракула (Р7).
 */
interface CreationContext {
  hostKind: FormulaHostKind;
  projectId?: string;
  nodeId?: string;
  parentId?: string;
}

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

  async evaluate(body: FormulaEvaluateBody, actor: AuthUser): Promise<FormulaEvaluateResponse> {
    const snapshot = await this.meta.snapshot();
    // zod-union контекста: запись либо ещё не созданная запись (creation).
    const ctx = body.context as {
      hostKind?: FormulaHostKind;
      hostId?: string;
      creation?: CreationContext;
    };
    const creation = ctx.creation ?? null;
    const hostKind = creation?.hostKind ?? ctx.hostKind!;
    // Форма AST (лимиты, матрица источников) проверяется и в превью:
    // иначе evaluate обходил бы запреты матрицы и лимиты языка (Р2/Р7).
    const shape = this.engine.validate(body.ast, {
      hostKind,
      meta: snapshot.meta,
    });
    const blocking = shape.issues.filter((issue) => issue.blocking);
    if (blocking.length > 0) {
      throw new DomainException(formulaErrorCodeOf(blocking[0]!.code), 'Formula is invalid', {
        issues: blocking,
      });
    }
    const context = creation
      ? await this.creationContext(creation, hostKind, body.ast, snapshot, actor)
      : await this.context.build({
          hostKind,
          hostId: ctx.hostId!,
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

  /** Контекст ещё не созданной записи (префилл окна создания, Р12): место
   *  задаёт проект/папка/родитель; доступ актора проверяется явно (Р7). */
  private async creationContext(
    creation: CreationContext,
    hostKind: FormulaHostKind,
    ast: FormulaNode,
    snapshot: Awaited<ReturnType<FormulaMetaService['snapshot']>>,
    actor: AuthUser,
  ) {
    const cache = createFormulaCache();
    const requestedProjectId = creation.projectId ?? null;
    // Узел — без актора (его видимость определяется проектом): сначала
    // дочитываем проект узла, иначе creation без projectId обходил бы Р7.
    let nodeProjectId: string | null = null;
    if (creation.nodeId) {
      const node = await this.context.record('node', creation.nodeId, undefined, undefined, cache);
      if (!node) throw DomainException.notFound('Formula host not found');
      nodeProjectId = node.projectId;
      if (requestedProjectId !== null && node.projectId !== requestedProjectId) {
        throw DomainException.notFound('Formula host not found');
      }
    }
    const effectiveProjectId = requestedProjectId ?? nodeProjectId;
    if (effectiveProjectId) {
      const project = await this.context.record(
        'project',
        effectiveProjectId,
        actor,
        undefined,
        cache,
      );
      if (!project) throw DomainException.notFound('Formula host not found');
    }
    if (creation.parentId) {
      const parent = await this.context.record('task', creation.parentId, actor, undefined, cache);
      if (!parent || (effectiveProjectId !== null && parent.projectId !== effectiveProjectId)) {
        throw DomainException.notFound('Formula host not found');
      }
    }
    const hostData: FormulaRecordData = {
      kind: hostKind,
      id: '00000000-0000-0000-0000-000000000000',
      values: {},
      system: {},
      projectId: effectiveProjectId,
      parentId: creation.parentId ?? null,
      nodeId: creation.nodeId ?? null,
      placeId: null,
      confidential: false,
    };
    return this.context.build({
      hostKind,
      hostId: hostData.id,
      asts: [ast],
      snapshot,
      hostData,
    });
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
