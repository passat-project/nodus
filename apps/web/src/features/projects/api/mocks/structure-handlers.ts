import { http, HttpResponse } from 'msw';
import {
  ErrorCode,
  NODE_LIMITS,
  Permission,
  batchCreateProjectNodesBodySchema,
  createProjectNodeBodySchema,
  moveProjectNodeBodySchema,
  nodeKindCreateBodySchema,
  nodeKindUpdateBodySchema,
  updateProjectNodeBodySchema,
  type NodeKind,
  type ProjectNode,
} from '@nodus/contracts';

import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import {
  accessOf,
  canSeeProject,
  myMembershipOf,
} from '../../../../shared/mocks/data/project-views.js';
import { findDemoProjectRow } from '../../../../shared/mocks/data/projects.js';
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

/** Моки структуры проекта (#467): дерево узлов демо-мира и справочник видов
 *  уровней. Узлы БЕЗ архивации: пустой удаляется, непустой — 409. Регистрация
 *  в projects-handlers ДО projectReadHandlers: буквальный /projects/node-kinds
 *  иначе уйдёт в параметрический /projects/:id (gotcha порядка MSW). */

const invalid = () =>
  HttpResponse.json(
    { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
    { status: 422 },
  );
const forbidden = () =>
  HttpResponse.json({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' }, { status: 403 });
const nodeNotFound = () =>
  HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'Node not found' }, { status: 404 });
const conflict = (code: ErrorCode, message: string) =>
  HttpResponse.json({ code, message }, { status: 409 });

/** Проект + право управления структурой (руководитель/помощник/manage);
 *  строковый вердикт сужается typeof — без объектных union. */
function manageableProject(id: string): 'forbidden' | 'notfound' | DemoProjectRowGuard {
  const actor = getMockActor();
  const row = findDemoProjectRow(id);
  if (!row || !canSeeProject(row, actor)) return 'notfound';
  return accessOf(row, myMembershipOf(row.id, actor.id), actor.permissions).canManage
    ? { row }
    : 'forbidden';
}
type DemoProjectRowGuard = { row: NonNullable<ReturnType<typeof findDemoProjectRow>> };

function guardResponse(verdict: 'forbidden' | 'notfound') {
  return verdict === 'forbidden' ? forbidden() : nodeNotFound();
}

/** Родитель узла: null (корень) или узел этого же проекта. */
function checkedParent(projectId: string, parentId: string | null | undefined) {
  if (parentId === undefined || parentId === null) return { parent: null };
  const parent = findDemoNodeRow(parentId);
  if (!parent || parent.projectId !== projectId) return 'notfound';
  return { parent };
}

function kindOf(kindId: string): NodeKind | undefined {
  return demoNodeKinds.find((kind) => kind.id === kindId);
}

/** Лимит глубины с учётом высоты переносимого поддерева. */
function subtreeHeight(row: DemoNodeRow): number {
  const children = demoNodeRows.filter((entry) => entry.parentId === row.id);
  return 1 + Math.max(0, ...children.map(subtreeHeight));
}

function appendNode(
  projectId: string,
  parentId: string | null,
  kindId: string,
  name: string,
  code: string | null,
): DemoNodeRow {
  const row: DemoNodeRow = {
    id: crypto.randomUUID(),
    projectId,
    parentId,
    kindId,
    name,
    code,
    createdAt: new Date().toISOString(),
  };
  demoNodeRows.push(row);
  return row;
}

export const structureHandlers = [
  // ===== Виды уровней (справочник «Автоматизации», право project.setup.manage) =====

  http.get('/api/v1/projects/node-kinds', ({ request }) => {
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === 'true';
    return HttpResponse.json(
      demoNodeKinds.filter((kind) => includeArchived || kind.archivedAt === null),
    );
  }),

  http.post('/api/v1/projects/node-kinds', async ({ request }) => {
    if (!getMockActor().permissions.includes(Permission.PROJECT_SETUP_MANAGE)) return forbidden();
    const parsed = nodeKindCreateBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const key = (name: string) => name.trim().toLowerCase();
    if (demoNodeKinds.some((kind) => key(kind.name) === key(parsed.data.name))) {
      return conflict(ErrorCode.PROJECT_NODE_KIND_NAME_TAKEN, 'Kind name is already taken');
    }
    const kind: NodeKind = { id: crypto.randomUUID(), archivedAt: null, ...parsed.data };
    demoNodeKinds.push(kind);
    return HttpResponse.json(kind, { status: 201 });
  }),

  http.patch('/api/v1/projects/node-kinds/:id', async ({ params, request }) => {
    if (!getMockActor().permissions.includes(Permission.PROJECT_SETUP_MANAGE)) return forbidden();
    const parsed = nodeKindUpdateBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalid();
    const kind = demoNodeKinds.find((entry) => entry.id === String(params.id));
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
    if (nextName) kind.name = nextName;
    if (parsed.data.icon) kind.icon = parsed.data.icon;
    if (parsed.data.color) kind.color = parsed.data.color;
    return HttpResponse.json(kind);
  }),

  /** Архивация вида (узлы архивного вида создавать нельзя, существующие живут). */
  http.delete('/api/v1/projects/node-kinds/:id', ({ params }) => {
    if (!getMockActor().permissions.includes(Permission.PROJECT_SETUP_MANAGE)) return forbidden();
    const kind = demoNodeKinds.find((entry) => entry.id === String(params.id));
    if (!kind) return nodeNotFound();
    kind.archivedAt = new Date().toISOString();
    return HttpResponse.json(kind);
  }),

  // ===== Дерево узлов проекта =====

  http.get('/api/v1/projects/:id/structure', ({ params }) => {
    const row = findDemoProjectRow(String(params.id));
    const actor = getMockActor();
    if (!row || !canSeeProject(row, actor)) return nodeNotFound();
    return HttpResponse.json({
      nodes: nodesOfProject(row.id).map(projectNodeDto),
      kinds: demoNodeKinds,
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
    if (!kind) return nodeNotFound();
    if (kind.archivedAt) {
      return conflict(ErrorCode.PROJECT_NODE_KIND_ARCHIVED, 'Kind is archived');
    }
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
    if (!kind) return nodeNotFound();
    if (kind.archivedAt) {
      return conflict(ErrorCode.PROJECT_NODE_KIND_ARCHIVED, 'Kind is archived');
    }
    if (nodesOfProject(guard.row.id).length + body.names.length > NODE_LIMITS.nodesPerProject) {
      return conflict(ErrorCode.PROJECT_NODE_LIMIT_REACHED, 'Node limit reached');
    }
    const nodes: ProjectNode[] = body.names.map((name) =>
      projectNodeDto(appendNode(guard.row.id, body.parentId ?? null, body.kindId, name, null)),
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
    if (body.kindId) {
      const kind = kindOf(body.kindId);
      if (!kind) return nodeNotFound();
      if (kind.archivedAt) {
        return conflict(ErrorCode.PROJECT_NODE_KIND_ARCHIVED, 'Kind is archived');
      }
      node.kindId = body.kindId;
    }
    if (body.name) node.name = body.name;
    if (body.code !== undefined) {
      if (body.code !== null && nodeCodeTaken(body.code, guard.row.id, node.id)) {
        return conflict(ErrorCode.PROJECT_NODE_CODE_TAKEN, 'Node code is already taken');
      }
      node.code = body.code;
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
