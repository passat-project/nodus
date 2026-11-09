import { http, HttpResponse } from 'msw';
import {
  ErrorCode,
  NODE_LIMITS,
  SYSTEM_FIELD_IDS,
  batchCreateProjectNodesBodySchema,
  createProjectNodeBodySchema,
  nodeFormKey,
  updateProjectNodeBodySchema,
  type CustomFieldValues,
  type ProjectNode,
  formSlots,
} from '@nodus/contracts';

import { definitionsForTarget } from '../../../../shared/custom-fields/module-target.js';
import { nodeWithFormulas } from '../../../../shared/custom-fields/formula/formula-dto.js';
import { lockedPatchResponse } from '../../../../shared/custom-fields/formula/formula-mocks.js';
import {
  invalidMockValues,
  withStaticDefaults,
} from '../../../../shared/custom-fields/mocks/custom-fields-mock-utils.js';
import { demoRefsForValues } from '../../../../shared/mocks/data/custom-fields-refs.js';
import { demoCustomFieldDefinitions } from '../../../../shared/mocks/data/custom-fields.js';
import { findDemoProjectRow } from '../../../../shared/mocks/data/projects.js';
import { canSeeProject } from '../../../../shared/mocks/data/project-views.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import {
  placeOfNewNode,
  planOnCreate,
  stripCounterValues,
} from '../../../../shared/mocks/data/numbering-create.js';
import {
  counterWriteResponse,
  numberingFailureResponse,
} from '../../../../shared/custom-fields/mocks/numbering-responses.js';
import {
  demoNodeKinds,
  findDemoNodeRow,
  nodeDepthOf,
  nodesOfProject,
  projectNodeDto,
  type DemoNodeRow,
} from '../../../../shared/mocks/data/project-nodes.js';
import {
  appendNode,
  assertKindAlive,
  checkedParent,
  conflict,
  guardResponse,
  invalid,
  kindAllowedForProject,
  codeOfValue,
  kindOf,
  manageableProject,
  nodeNotFound,
  ruleResponse,
  valuesInvalid,
} from './structure-mock-kit.js';
import { createIssues, formOfKind, updateIssues } from './node-form-rules.js';
import { structureNodeMoveHandlers } from './structure-node-move-handlers.js';

export const structureNodeHandlers = [
  http.get('/api/v1/projects/:id/structure', ({ params }) => {
    const row = findDemoProjectRow(String(params.id));
    const actor = getMockActor();
    if (!row || !canSeeProject(row, actor)) return nodeNotFound();
    // Формулы вида папки (#632) считаются на чтении: DTO клонируется,
    // хранимые строки структуры не мутируются.
    const nodes = nodesOfProject(row.id).map((nodeRow) =>
      nodeWithFormulas(projectNodeDto(nodeRow), nodeRow.kindId),
    );
    return HttpResponse.json({
      nodes,
      kinds: demoNodeKinds,
      // Одна пачка ссылок на все значения папок (О2).
      customFieldRefs: demoRefsForValues(
        Object.assign({}, ...nodes.map((node) => node.customFields)),
      ),
    });
  }),

  http.post('/api/v1/projects/:id/nodes', async ({ params, request }) => {
    const guard = manageableProject(String(params.id));
    if (typeof guard === 'string') return guardResponse(guard);
    const parsed = createProjectNodeBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const body = parsed.data;
    const parent = checkedParent(guard.row.id, body.parentId);
    if (typeof parent === 'string') return nodeNotFound();
    const kind = kindOf(body.kindId);
    const archived = assertKindAlive(kind);
    if (archived) return archived;
    if (!kindAllowedForProject(guard.row.id, body.kindId)) {
      return HttpResponse.json(
        { code: ErrorCode.PROJECT_NODE_KIND_NOT_ALLOWED, message: 'Kind is not allowed' },
        { status: 422 },
      );
    }
    // Legacy `code` переводится в атрибут «Код» только если слот есть в
    // форме вида (как `withLegacyCode` сервера); явное customFields важнее.
    const bound = definitionsForTarget(demoCustomFieldDefinitions, 'node', kind!.id);
    const values = withStaticDefaults(bound, { ...(body.customFields ?? {}) });
    if (
      body.code != null &&
      values[SYSTEM_FIELD_IDS.nodeCode] === undefined &&
      formSlots(formOfKind(kind!)).some((slot) => slot.fieldId === SYSTEM_FIELD_IDS.nodeCode)
    ) {
      values[SYSTEM_FIELD_IDS.nodeCode] = body.code;
    }
    const malformed = invalidMockValues(bound, values);
    if (malformed.length > 0) return valuesInvalid(malformed);
    const rule = ruleResponse(createIssues(kind!, { customFields: values }));
    if (rule) return rule;
    const code = codeOfValue(values[SYSTEM_FIELD_IDS.nodeCode]);
    if (nodesOfProject(guard.row.id).length >= NODE_LIMITS.nodesPerProject) {
      return conflict(ErrorCode.PROJECT_NODE_LIMIT_REACHED, 'Node limit reached');
    }
    if ((parent.parent ? nodeDepthOf(parent.parent) + 1 : 0) + 1 > NODE_LIMITS.depth) {
      return conflict(ErrorCode.PROJECT_NODE_INVALID, 'Depth limit reached');
    }
    // Счётчики «при создании» (#630, модель v3): номер из тела отбрасывается,
    // значения условий — ДО создания (нет места — 409, ничего не тратится),
    // выдача — в той же «транзакции», что и папка.
    const clean = stripCounterValues(values);
    const numbering = planOnCreate(
      placeOfNewNode(guard.row.id, body.parentId ?? null, body.kindId, clean),
      clean,
      { source: 'create', confirmEmpty: body.confirmEmptyNumberParts === true },
    );
    if (!numbering.ok) return numberingFailureResponse(numbering.failure);
    const row = appendNode(
      guard.row.id,
      body.parentId ?? null,
      body.kindId,
      body.name,
      code,
      clean as typeof values,
    );
    const numbers = numbering.issue(row.id);
    if (Object.keys(numbers).length > 0) row.customFields = { ...row.customFields, ...numbers };
    return HttpResponse.json(projectNodeDto(row), { status: 201 });
  }),

  http.post('/api/v1/projects/:id/nodes/batch', async ({ params, request }) => {
    const guard = manageableProject(String(params.id));
    if (typeof guard === 'string') return guardResponse(guard);
    const parsed = batchCreateProjectNodesBodySchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return invalid();
    const body = parsed.data;
    const parent = checkedParent(guard.row.id, body.parentId);
    if (typeof parent === 'string') return nodeNotFound();
    const kind = kindOf(body.kindId);
    const archived = assertKindAlive(kind);
    if (archived) return archived;
    if (!kindAllowedForProject(guard.row.id, body.kindId)) {
      return HttpResponse.json(
        { code: ErrorCode.PROJECT_NODE_KIND_NOT_ALLOWED, message: 'Kind is not allowed' },
        { status: 422 },
      );
    }
    // Пачка при обязательном «Коде» вида невозможна: у каждой папки свой код (В1).
    if (
      formSlots(formOfKind(kind!)).some(
        (slot) => slot.fieldId === SYSTEM_FIELD_IDS.nodeCode && slot.state === 'required',
      )
    ) {
      return HttpResponse.json(
        {
          code: 'PROJECT_NODE_FIELDS_REQUIRED',
          message: 'Required node fields are missing',
          details: {
            kindId: kind!.id,
            fields: [nodeFormKey(SYSTEM_FIELD_IDS.nodeCode)],
            reason: 'create',
          },
        },
        { status: 422 },
      );
    }
    const rule = ruleResponse(createIssues(kind!, { customFields: body.customFields }));
    if (rule) return rule;
    if (nodesOfProject(guard.row.id).length + body.names.length > NODE_LIMITS.nodesPerProject) {
      return conflict(ErrorCode.PROJECT_NODE_LIMIT_REACHED, 'Node limit reached');
    }
    // Счётчики «при создании» (#630): пачка — одна «транзакция»: место для
    // счёта проверяется ДО создания (у всех папок пачки оно общее — один
    // родитель), номера выдаются по порядку имён пачки.
    const clean = stripCounterValues(body.customFields ?? {});
    const target = placeOfNewNode(guard.row.id, body.parentId ?? null, body.kindId, clean);
    const numbering = planOnCreate(target, clean, {
      source: 'create',
      confirmEmpty: body.confirmEmptyNumberParts === true,
    });
    if (!numbering.ok) return numberingFailureResponse(numbering.failure);
    const nodes: ProjectNode[] = body.names.map((name) => {
      const row = appendNode(guard.row.id, body.parentId ?? null, body.kindId, name, null, clean);
      const numbers = numbering.issue(row.id);
      if (Object.keys(numbers).length > 0) row.customFields = { ...row.customFields, ...numbers };
      return projectNodeDto(row);
    });
    return HttpResponse.json({ nodes }, { status: 201 });
  }),

  http.patch('/api/v1/projects/:id/nodes/:nodeId', async ({ params, request }) => {
    const guard = manageableProject(String(params.id));
    if (typeof guard === 'string') return guardResponse(guard);
    const parsed = updateProjectNodeBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const body = parsed.data;
    const node = findDemoNodeRow(String(params.nodeId));
    if (!node || node.projectId !== guard.row.id) return nodeNotFound();
    const kindChanged = body.kindId !== undefined && body.kindId !== node.kindId;
    // Архивный/снятый с типа вид живёт у существующих папок: проверяем
    // живость только при СМЕНЕ вида (как сервер).
    if (kindChanged) {
      const kind = kindOf(body.kindId!);
      const archived = assertKindAlive(kind);
      if (archived) return archived;
      if (!kindAllowedForProject(guard.row.id, body.kindId!)) {
        return HttpResponse.json(
          { code: ErrorCode.PROJECT_NODE_KIND_NOT_ALLOWED, message: 'Kind is not allowed' },
          { status: 422 },
        );
      }
    }
    const kind = kindOf(body.kindId ?? node.kindId);
    if (!kind) return nodeNotFound();
    const patchValues = { ...(body.customFields ?? {}) };
    // Legacy `code` — только если слот «Код» есть в форме; явное значение
    // customFields важнее (как `node-form.policy.ts`).
    if (
      body.code !== undefined &&
      patchValues[SYSTEM_FIELD_IDS.nodeCode] === undefined &&
      formSlots(formOfKind(kind)).some((slot) => slot.fieldId === SYSTEM_FIELD_IDS.nodeCode)
    ) {
      patchValues[SYSTEM_FIELD_IDS.nodeCode] = body.code;
    }
    const malformed = invalidMockValues(
      definitionsForTarget(demoCustomFieldDefinitions, 'node', kind.id),
      patchValues as CustomFieldValues,
    );
    if (malformed.length > 0) return valuesInvalid(malformed);
    const rule = ruleResponse(
      updateIssues(
        kind,
        { customFields: node.customFields },
        { customFields: patchValues },
        kindChanged,
      ),
    );
    if (rule) return rule;
    // Формульная ячейка руками не пишется (#660): 422, как на сервере.
    const lockedNode = lockedPatchResponse('node', node.id, node.customFields, patchValues);
    if (lockedNode) return lockedNode;
    // Номер счётчика руками не пишется (#630): 422 NUMBER_CELL_IMMUTABLE.
    const counterWrite = counterWriteResponse(patchValues);
    if (counterWrite) return counterWrite;
    // Смена вида на вид с номером «при создании» (#630, вердикт 08.11):
    // номер выдаётся в этот момент; нет нужного места — 409, вид не меняется.
    const retyped = kindChanged
      ? planOnCreate(
          placeOfNewNode(guard.row.id, node.parentId, body.kindId!, node.customFields),
          node.customFields,
          { source: 'type_change', confirmEmpty: body.confirmEmptyNumberParts === true },
        )
      : null;
    if (retyped && !retyped.ok) return numberingFailureResponse(retyped.failure);
    if (kindChanged) node.kindId = body.kindId!;
    if (retyped?.ok) {
      const numbers = retyped.issue(node.id);
      if (Object.keys(numbers).length > 0) node.customFields = { ...node.customFields, ...numbers };
    }
    if (body.name) node.name = body.name;
    if (Object.keys(patchValues).length > 0) {
      const next: DemoNodeRow['customFields'] = { ...node.customFields };
      for (const [fieldId, value] of Object.entries(patchValues)) {
        if (value === null) delete next[fieldId];
        else next[fieldId] = value;
      }
      node.customFields = next;
      node.code = codeOfValue(next[SYSTEM_FIELD_IDS.nodeCode]);
    }
    return HttpResponse.json(nodeWithFormulas(projectNodeDto(node), node.kindId));
  }),

  // Перенос и удаление папок — соседний модуль (I5).
  ...structureNodeMoveHandlers,
];
