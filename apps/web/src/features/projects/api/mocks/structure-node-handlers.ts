import { http, HttpResponse } from 'msw';
import {
  ErrorCode,
  NODE_LIMITS,
  batchCreateProjectNodesBodySchema,
  createProjectNodeBodySchema,
  moveProjectNodeBodySchema,
  updateProjectNodeBodySchema,
  type ProjectNode,
} from '@nodus/contracts';

import { demoRefsForValues } from '../../../../shared/mocks/data/custom-fields-refs.js';
import { findDemoProjectRow } from '../../../../shared/mocks/data/projects.js';
import { canSeeProject } from '../../../../shared/mocks/data/project-views.js';
import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import {
  childNodeRows,
  demoNodeKinds,
  demoNodeRows,
  descendantIdsOf,
  directTasksOf,
  findDemoNodeRow,
  nodeCodeTaken,
  nodeDepthOf,
  nodesOfProject,
  projectNodeDto,
  type DemoNodeRow,
} from '../../../../shared/mocks/data/project-nodes.js';
import {
  assertKindAlive,
  checkedParent,
  conflict,
  guardResponse,
  invalid,
  kindOf,
  manageableProject,
  nodeNotFound,
  ruleResponse,
  subtreeHeight,
} from './structure-mock-kit.js';
import { createIssues, formOfKind, updateIssues } from './node-form-rules.js';

/** Дерево папок проекта в мок-мире (#467, #556): создание, пачка, правка
 *  (имя/шифр/вид/значения), перенос, удаление пустой. Правила формы вида —
 *  помощники контрактов (`node-form-rules.ts`), отказ мока = отказ сервера. */

function appendNode(
  projectId: string,
  parentId: string | null,
  kindId: string,
  name: string,
  code: string | null,
  customFields: DemoNodeRow['customFields'],
): DemoNodeRow {
  const row: DemoNodeRow = {
    id: crypto.randomUUID(),
    projectId,
    parentId,
    kindId,
    name,
    code,
    customFields,
    createdAt: new Date().toISOString(),
  };
  demoNodeRows.push(row);
  return row;
}

export const structureNodeHandlers = [
  http.get('/api/v1/projects/:id/structure', ({ params }) => {
    const row = findDemoProjectRow(String(params.id));
    const actor = getMockActor();
    if (!row || !canSeeProject(row, actor)) return nodeNotFound();
    const nodes = nodesOfProject(row.id).map(projectNodeDto);
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
    const rule = ruleResponse(
      createIssues(kind!, { code: body.code ?? null, customFields: body.customFields }),
    );
    if (rule) return rule;
    if (body.code && nodeCodeTaken(body.code, guard.row.id, null)) {
      return conflict(ErrorCode.PROJECT_NODE_CODE_TAKEN, 'Node code is already taken');
    }
    if (nodesOfProject(guard.row.id).length >= NODE_LIMITS.nodesPerProject) {
      return conflict(ErrorCode.PROJECT_NODE_LIMIT_REACHED, 'Node limit reached');
    }
    if ((parent.parent ? nodeDepthOf(parent.parent) + 1 : 0) + 1 > NODE_LIMITS.depth) {
      return conflict(ErrorCode.PROJECT_NODE_INVALID, 'Depth limit reached');
    }
    const row = appendNode(
      guard.row.id,
      body.parentId ?? null,
      body.kindId,
      body.name,
      body.code ?? null,
      body.customFields ?? {},
    );
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
    // Пачка при обязательном шифре вида невозможна: у каждой папки свой шифр (В1).
    if (formOfKind(kind!).code === 'required') {
      return HttpResponse.json(
        {
          code: 'PROJECT_NODE_FIELDS_REQUIRED',
          message: 'Required node fields are missing',
          details: { kindId: kind!.id, fields: ['code'], reason: 'create' },
        },
        { status: 422 },
      );
    }
    const rule = ruleResponse(createIssues(kind!, { code: null, customFields: body.customFields }));
    if (rule) return rule;
    if (nodesOfProject(guard.row.id).length + body.names.length > NODE_LIMITS.nodesPerProject) {
      return conflict(ErrorCode.PROJECT_NODE_LIMIT_REACHED, 'Node limit reached');
    }
    const nodes: ProjectNode[] = body.names.map((name) =>
      projectNodeDto(
        appendNode(
          guard.row.id,
          body.parentId ?? null,
          body.kindId,
          name,
          null,
          body.customFields ?? {},
        ),
      ),
    );
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
    const kind = kindOf(body.kindId ?? node.kindId);
    const archived = assertKindAlive(kind);
    if (archived) return archived;
    const rule = ruleResponse(
      updateIssues(
        kind!,
        { code: node.code, customFields: node.customFields },
        { code: body.code, customFields: body.customFields },
        kindChanged,
      ),
    );
    if (rule) return rule;
    if (body.code !== undefined) {
      if (body.code !== null && nodeCodeTaken(body.code, guard.row.id, node.id)) {
        return conflict(ErrorCode.PROJECT_NODE_CODE_TAKEN, 'Node code is already taken');
      }
      node.code = body.code;
    }
    if (kindChanged) node.kindId = body.kindId!;
    if (body.name) node.name = body.name;
    if (body.customFields) {
      const next: DemoNodeRow['customFields'] = { ...node.customFields };
      for (const [fieldId, value] of Object.entries(body.customFields)) {
        if (value === null) delete next[fieldId];
        else next[fieldId] = value;
      }
      node.customFields = next;
    }
    return HttpResponse.json(projectNodeDto(node));
  }),

  http.post('/api/v1/projects/:id/nodes/:nodeId/move', async ({ params, request }) => {
    const guard = manageableProject(String(params.id));
    if (typeof guard === 'string') return guardResponse(guard);
    const parsed = moveProjectNodeBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const body = parsed.data;
    const node = findDemoNodeRow(String(params.nodeId));
    if (!node || node.projectId !== guard.row.id) return nodeNotFound();
    const parent = checkedParent(guard.row.id, body.parentId);
    if (typeof parent === 'string') return nodeNotFound();
    if (
      body.parentId !== null &&
      (body.parentId === node.id || descendantIdsOf(node.id).has(body.parentId))
    ) {
      return conflict(ErrorCode.PROJECT_NODE_CYCLE, 'Cannot move node into itself');
    }
    const newDepth = body.parentId && parent.parent ? nodeDepthOf(parent.parent) + 1 : 0;
    if (newDepth + subtreeHeight(node) - 1 > NODE_LIMITS.depth) {
      return conflict(ErrorCode.PROJECT_NODE_INVALID, 'Depth limit reached');
    }
    if (
      body.parentId !== null &&
      childNodeRows(body.parentId, guard.row.id).length >= NODE_LIMITS.childrenPerParent
    ) {
      return conflict(ErrorCode.PROJECT_NODE_LIMIT_REACHED, 'Children limit reached');
    }
    const anchorOf = (id: string | null | undefined) =>
      id ? demoNodeRows.find((row) => row.id === id && row.parentId === body.parentId) : undefined;
    const before = anchorOf(body.beforeId);
    const after = anchorOf(body.afterId);
    if ((body.beforeId && !before) || (body.afterId && !after)) return invalid();
    // Порядок сиблингов = порядок в массиве: вынимаем и вставляем по якорю,
    // без якоря — последним ребёнком родителя.
    demoNodeRows.splice(demoNodeRows.indexOf(node), 1);
    node.parentId = body.parentId;
    if (before) demoNodeRows.splice(demoNodeRows.indexOf(before), 0, node);
    else if (after) demoNodeRows.splice(demoNodeRows.indexOf(after) + 1, 0, node);
    else {
      const children = childNodeRows(body.parentId, guard.row.id).filter(
        (row) => row.id !== node.id,
      );
      const last = children[children.length - 1];
      if (last) demoNodeRows.splice(demoNodeRows.indexOf(last) + 1, 0, node);
      else demoNodeRows.push(node);
    }
    return HttpResponse.json(projectNodeDto(node));
  }),

  http.delete('/api/v1/projects/:id/nodes/:nodeId', ({ params }) => {
    const guard = manageableProject(String(params.id));
    if (typeof guard === 'string') return guardResponse(guard);
    const node = findDemoNodeRow(String(params.nodeId));
    if (!node || node.projectId !== guard.row.id) return nodeNotFound();
    const hasChildren = demoNodeRows.some((row) => row.parentId === node.id);
    if (hasChildren || directTasksOf(node.id).length > 0) {
      return conflict(ErrorCode.PROJECT_NODE_NOT_EMPTY, 'Node is not empty');
    }
    demoNodeRows.splice(demoNodeRows.indexOf(node), 1);
    return new HttpResponse(null, { status: 204 });
  }),
];
