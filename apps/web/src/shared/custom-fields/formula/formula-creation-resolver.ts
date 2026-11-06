import type { FormulaHostKind } from '@nodus/contracts';
import type { FormulaResolver } from '@nodus/formula-engine';

import { findDemoNodeRow } from '../../mocks/data/project-nodes.js';

import { findDemoTask } from './formula-state.js';
import { isTaskVisible, projectRecord, resolverForHost } from './formula-resolver.js';

/**
 * Резолвер ещё не созданной записи (префилл окна создания, Р12): место
 * задаёт проект/папка/родитель, значения пустые. Невидимое или несуществующее
 * место — null (мок-эндпоинт отвечает 404).
 */
export function demoCreationResolver(creation: {
  hostKind: FormulaHostKind;
  projectId?: string;
  nodeId?: string;
  parentId?: string;
}): FormulaResolver | null {
  if (creation.projectId && !projectRecord(creation.projectId)) return null;
  if (creation.nodeId) {
    const node = findDemoNodeRow(creation.nodeId);
    if (!node) return null;
    if (creation.projectId && node.projectId !== creation.projectId) return null;
  }
  if (creation.parentId) {
    const parent = findDemoTask(creation.parentId);
    if (!parent || !isTaskVisible(parent)) return null;
  }
  return resolverForHost({
    kind: creation.hostKind,
    id: '00000000-0000-0000-0000-000000000000',
    customFields: {},
    projectId: creation.projectId ?? null,
    nodeId: creation.nodeId ?? null,
    parentId: creation.parentId ?? null,
  });
}
