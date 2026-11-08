import { http, HttpResponse } from 'msw';
import {
  ErrorCode,
  DEFAULT_NODE_KIND_FORM,
  nodeKindCreateBodySchema,
  nodeKindUpdateBodySchema,
  normalizeNodeKindCapabilities,
  type NodeKind,
  formSlots,
} from '@nodus/contracts';

import { demoCustomFieldDefinitions } from '../../../../shared/mocks/data/custom-fields.js';
import { demoNodeKinds } from '../../../../shared/mocks/data/project-nodes.js';
import {
  conflict,
  forbidden,
  hasSetupRight,
  invalid,
  kindOf,
  nodeNotFound,
  ruleResponse,
} from './structure-mock-kit.js';
import { kindFormInvalidIssue, kindFormIssues } from './node-form-rules.js';

/** Слот формы вида ↔ привязка атрибута к виду (Р3 #631, зеркало мока типов
 *  проектов и сервера): добавленный слот привязывает, убранный — снимает. */
function syncKindBindings(
  kindId: string,
  before: readonly string[],
  after: readonly string[],
): void {
  for (const definition of demoCustomFieldDefinitions) {
    const bound = definition.bindings.nodeKindIds.includes(kindId);
    const inForm = after.includes(definition.id);
    if (inForm && !bound) definition.bindings.nodeKindIds.push(kindId);
    if (!inForm && bound && before.includes(definition.id)) {
      definition.bindings.nodeKindIds = definition.bindings.nodeKindIds.filter(
        (id) => id !== kindId,
      );
    }
  }
}

/** Виды папок как настраиваемые типы (#556): реестр и мутации мок-мира.
 *  Правила формы — помощники контрактов (одна грамматика с сервером);
 *  архив — не удаление: папки архивного вида живут, новые создавать нельзя. */

export const structureKindHandlers = [
  http.get('/api/v1/projects/node-kinds', () => HttpResponse.json(demoNodeKinds)),

  http.post('/api/v1/projects/node-kinds', async ({ request }) => {
    if (!hasSetupRight()) return forbidden();
    const parsed = nodeKindCreateBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const key = (name: string) => name.trim().toLowerCase();
    if (demoNodeKinds.some((kind) => key(kind.name) === key(parsed.data.name))) {
      return conflict(ErrorCode.PROJECT_NODE_KIND_NAME_TAKEN, 'Kind name is already taken');
    }
    const kind: NodeKind = {
      id: crypto.randomUUID(),
      archivedAt: null,
      form: DEFAULT_NODE_KIND_FORM,
      capabilities: [],
      ...parsed.data,
    };
    demoNodeKinds.push(kind);
    return HttpResponse.json(kind, { status: 201 });
  }),

  http.patch('/api/v1/projects/node-kinds/:id', async ({ params, request }) => {
    if (!hasSetupRight()) return forbidden();
    const parsed = nodeKindUpdateBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const kind = kindOf(String(params.id));
    if (!kind) return nodeNotFound();
    const nextName = parsed.data.name;
    if (
      nextName &&
      demoNodeKinds.some(
        (entry) =>
          entry.id !== kind.id && entry.name.trim().toLowerCase() === nextName.trim().toLowerCase(),
      )
    ) {
      return conflict(ErrorCode.PROJECT_NODE_KIND_NAME_TAKEN, 'Kind name is already taken');
    }
    if (parsed.data.form) {
      const issues = kindFormIssues(kind, parsed.data.form);
      const response = issues.length > 0 ? ruleResponse(kindFormInvalidIssue(issues)) : null;
      if (response) return response;
      syncKindBindings(
        kind.id,
        formSlots(kind.form).map((slot) => slot.fieldId),
        formSlots(parsed.data.form).map((slot) => slot.fieldId),
      );
      kind.form = parsed.data.form;
    }
    if (parsed.data.capabilities) {
      kind.capabilities = normalizeNodeKindCapabilities(parsed.data.capabilities);
    }
    if (nextName) kind.name = nextName;
    if (parsed.data.icon) kind.icon = parsed.data.icon;
    if (parsed.data.color) kind.color = parsed.data.color;
    return HttpResponse.json(kind);
  }),

  http.delete('/api/v1/projects/node-kinds/:id', ({ params }) => {
    if (!hasSetupRight()) return forbidden();
    const kind = kindOf(String(params.id));
    if (!kind) return nodeNotFound();
    kind.archivedAt = new Date().toISOString();
    return HttpResponse.json(kind);
  }),

  http.post('/api/v1/projects/node-kinds/:id/restore', ({ params }) => {
    if (!hasSetupRight()) return forbidden();
    const kind = kindOf(String(params.id));
    if (!kind) return nodeNotFound();
    kind.archivedAt = null;
    return HttpResponse.json(kind);
  }),
];
