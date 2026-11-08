import { http, HttpResponse } from 'msw';
import {
  ErrorCode,
  NODE_LIMITS,
  moveProjectNodeBodySchema,
  type FormulaMovePreviewResponse,
} from '@nodus/contracts';

import {
  childNodeRows,
  demoNodeRows,
  descendantIdsOf,
  directTasksOf,
  findDemoNodeRow,
  nodeDepthOf,
  projectNodeDto,
} from '../../../../shared/mocks/data/project-nodes.js';
import {
  checkedParent,
  conflict,
  guardResponse,
  invalid,
  manageableProject,
  nodeNotFound,
  subtreeHeight,
} from './structure-mock-kit.js';

/** Перенос и удаление папок структуры в моках (#467): вынесено из
 *  `structure-node-handlers.ts` (I5) — правила те же, что у сервера. */
export const structureNodeMoveHandlers = [
  // Превью формульного диффа переноса (#632, критерий 1): демо-мир без
  // формульных переносов — дифф пуст, окно подтверждения не открывается.
  // Права те же, что у переноса (structure manage), 404 — как у move.
  http.post('/api/v1/projects/:id/nodes/:nodeId/move-preview', ({ params }) => {
    const guard = manageableProject(String(params.id));
    if (typeof guard === 'string') return guardResponse(guard);
    const node = findDemoNodeRow(String(params.nodeId));
    if (!node || node.projectId !== guard.row.id) return nodeNotFound();
    return HttpResponse.json({ changes: [] } satisfies FormulaMovePreviewResponse);
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
