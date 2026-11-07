import type { FormulaHostKind } from '@nodus/contracts';
import {
  ErrorCode,
  formulaBodySchema,
  formulaEvaluateBodySchema,
  formulaValidateBodySchema,
} from '@nodus/contracts';
import { evaluate, validateFormula } from '@nodus/formula-engine';
import { http, HttpResponse } from 'msw';

import { demoFieldById } from '../../mocks/data/custom-fields.js';

import { demoCreationResolver } from './formula-creation-resolver.js';
import { effectiveFormula, removeOwnFormula, saveOwnFormula } from './formula-mocks.js';
import { demoResolver } from './formula-resolver.js';
import { demoFormulaMeta, findFormulaHost } from './formula-state.js';

/** Мок-сервер формул (#632, Р10): маршруты у владельца хоста (I3) —
 *  GET/PUT/DELETE `/…/custom-fields/:fieldId/formula`, плюс проверка и
 *  превью без записи `/custom-fields/formulas/validate|evaluate`. Правила
 *  те же, что у сервера: 404 — неизвестный хост/атрибут, 400 — битое тело,
 *  422 — блокирующая проблема формулы (код по каталогу `FORMULA_*`).
 *  Ошибка ячейки (деление на ноль и т.п.) сохранение НЕ блокирует. */

function notFound(message = 'Formula host not found') {
  return HttpResponse.json({ code: ErrorCode.NOT_FOUND, message }, { status: 404 });
}

function badRequest() {
  return HttpResponse.json(
    { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
    { status: 400 },
  );
}

/** Хост и атрибут из параметров маршрута; null — 404 уже собран. */
function hostAndField(
  kind: FormulaHostKind,
  params: Record<string, unknown>,
  hostParam: string,
  projectParam?: string,
): { hostId: string; fieldId: string } | Response {
  const host = findFormulaHost(kind, String(params[hostParam]));
  if (!host) return notFound();
  if (projectParam && host.projectId !== String(params[projectParam])) return notFound();
  const fieldId = String(params.fieldId);
  if (!demoFieldById(fieldId)) return notFound('Custom field not found');
  return { hostId: host.id, fieldId };
}

/** CRUD формулы ячейки по маршруту владельца хоста. */
function hostFormulaHandlers(opts: {
  path: string;
  kind: FormulaHostKind;
  hostParam: string;
  projectParam?: string;
}) {
  const resolve = (params: Record<string, unknown>) =>
    hostAndField(opts.kind, params, opts.hostParam, opts.projectParam);
  return [
    http.get(opts.path, ({ params }) => {
      const target = resolve(params);
      if (target instanceof Response) return target;
      return HttpResponse.json(effectiveFormula(opts.kind, target.hostId, target.fieldId));
    }),

    http.put(opts.path, async ({ params, request }) => {
      const target = resolve(params);
      if (target instanceof Response) return target;
      const parsed = formulaBodySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return badRequest();
      const result = saveOwnFormula(opts.kind, target.hostId, target.fieldId, parsed.data.ast);
      if (!result.ok) {
        if (!result.code) return notFound('Custom field not found');
        return HttpResponse.json(
          {
            code: result.code,
            message: result.code,
            details: { issues: result.issues ?? [] },
          },
          { status: 422 },
        );
      }
      return HttpResponse.json({ ast: parsed.data.ast });
    }),

    // Снятие формулы: вычисленное значение очищается (#660), ответ без тела.
    http.delete(opts.path, ({ params }) => {
      const target = resolve(params);
      if (target instanceof Response) return target;
      removeOwnFormula(opts.kind, target.hostId, target.fieldId);
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}

export const formulaHandlers = [
  // Проверка без записи (редактор): тип цели берётся из реестра.
  http.post('/api/v1/custom-fields/formulas/validate', async ({ request }) => {
    const parsed = formulaValidateBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest();
    const body = parsed.data;
    const definition = body.targetFieldId ? demoFieldById(body.targetFieldId) : undefined;
    if (body.targetFieldId && !definition) return notFound('Custom field not found');
    const targetFieldType = body.targetType ?? definition?.type;
    const result = validateFormula(body.ast, {
      hostKind: body.hostKind,
      meta: demoFormulaMeta(),
      ...(targetFieldType ? { targetFieldType } : {}),
      ...(body.typeDefault ? { typeDefault: true } : {}),
    });
    return HttpResponse.json({
      ok: result.ok,
      type: result.type,
      issues: result.issues,
    });
  }),

  // Превью/префилл без записи: контекст — запись мок-мира или создание.
  http.post('/api/v1/custom-fields/formulas/evaluate', async ({ request }) => {
    const parsed = formulaEvaluateBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest();
    const body = parsed.data;
    const ctx = body.context as {
      hostKind?: Parameters<typeof demoResolver>[0];
      hostId?: string;
      creation?: Parameters<typeof demoCreationResolver>[0];
    };
    const resolver = ctx.creation
      ? demoCreationResolver(ctx.creation)
      : demoResolver(ctx.hostKind!, ctx.hostId!);
    if (!resolver) return notFound();
    const result = evaluate(body.ast, resolver);
    return HttpResponse.json({ value: result.value, error: result.error });
  }),

  ...hostFormulaHandlers({
    path: '/api/v1/tasks/:taskId/custom-fields/:fieldId/formula',
    kind: 'task',
    hostParam: 'taskId',
  }),
  ...hostFormulaHandlers({
    path: '/api/v1/letters/:letterId/custom-fields/:fieldId/formula',
    kind: 'letter',
    hostParam: 'letterId',
  }),
  ...hostFormulaHandlers({
    path: '/api/v1/projects/:projectId/custom-fields/:fieldId/formula',
    kind: 'project',
    hostParam: 'projectId',
  }),
  // Папка живёт под проектом: маршрут вложен, проект проверяется.
  ...hostFormulaHandlers({
    path: '/api/v1/projects/:projectId/nodes/:nodeId/custom-fields/:fieldId/formula',
    kind: 'node',
    hostParam: 'nodeId',
    projectParam: 'projectId',
  }),
];
