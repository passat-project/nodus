import { ErrorCode, NODE_LIMITS } from '@nodus/contracts';

import { keyBetween } from '../../core/lib/fractional-index.js';
import { DomainException } from '../../core/errors/domain-exception.js';

/** Минимальная форма узла для расчётов дерева (порядок — fractional-ключ). */
export interface TreeNodeLike {
  id: string;
  parentId: string | null;
  order: string;
}

/** Дети по родителю (null — корень), внутри — по ключу порядка (байтовый
 *  порядок base62-ключей совпадает с memcmp/COLLATE "C"). */
export function childrenByParent(
  nodes: readonly TreeNodeLike[],
): Map<string | null, TreeNodeLike[]> {
  const children = new Map<string | null, TreeNodeLike[]>();
  for (const node of nodes) {
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => (a.order < b.order ? -1 : 1));
  return children;
}

/** Карта id → parentId (ход вверх к корню). */
export function parentOf(nodes: readonly TreeNodeLike[]): Map<string, string | null> {
  return new Map(nodes.map((node) => [node.id, node.parentId]));
}

/** Глубина узла (корень = 1); предохранитель от испорченного дерева. */
export function nodeDepth(parents: Map<string, string | null>, id: string): number {
  let depth = 1;
  let current: string | null = id;
  while (depth <= NODE_LIMITS.depth + 1) {
    const next: string | null | undefined = parents.get(current);
    if (next === undefined || next === null) return depth;
    current = next;
    depth++;
  }
  return depth;
}

/** Высота поддерева (сам узел = 1); предохранитель от циклов. */
export function subtreeHeight(children: Map<string | null, TreeNodeLike[]>, id: string): number {
  let max = 1;
  const stack: { id: string; kind: number }[] = [{ id, kind: 1 }];
  const seen = new Set<string>([id]);
  while (stack.length > 0) {
    const { id: current, kind } = stack.pop()!;
    max = Math.max(max, kind);
    if (kind >= NODE_LIMITS.depth) continue;
    for (const child of children.get(current) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      stack.push({ id: child.id, kind: kind + 1 });
    }
  }
  return max;
}

/** Потомок ли `id` узла `ancestorId` (включительно не считается). */
export function isDescendantOf(
  parents: Map<string, string | null>,
  id: string,
  ancestorId: string,
): boolean {
  let current: string | null | undefined = parents.get(id);
  let steps = 0;
  while (current !== undefined && current !== null && steps <= NODE_LIMITS.depth + 1) {
    if (current === ancestorId) return true;
    current = parents.get(current);
    steps++;
  }
  return false;
}

/** Позиция вставки якоря среди порядков братьев. */
export type AnchorSide = 'before' | 'after' | 'end';

/**
 * Ключ порядка для позиции среди детей родителя: якорь (его текущий ключ)
 * со стороной или конец списка. Список — ключи братьев БЕЗ переносимого
 * узла; ключей всегда есть третий (канон fractional-index).
 */
export function orderKeyFor(
  siblingOrders: readonly string[],
  anchorOrder: string | null,
  side: AnchorSide,
): string {
  if (side === 'end' || anchorOrder === null) {
    return keyBetween(siblingOrders.at(-1) ?? null, null);
  }
  const index = siblingOrders.indexOf(anchorOrder);
  if (index < 0) {
    throw new Error(`structure: anchor order "${anchorOrder}" not among siblings`);
  }
  if (side === 'before') {
    return keyBetween(index > 0 ? siblingOrders[index - 1]! : null, anchorOrder);
  }
  return keyBetween(
    anchorOrder,
    index < siblingOrders.length - 1 ? siblingOrders[index + 1]! : null,
  );
}

/** Узел не подходит (не найден / чужой проект) — без оракула (I7). */
export function nodeInvalid(id: string): DomainException {
  return new DomainException(ErrorCode.PROJECT_NODE_INVALID, 'Node is not available', {
    nodeId: id,
  });
}

/** Достигнут лимит структуры (узлы проекта / дети / глубина / пакет). */
export function limitError(kind: string, limit: number): DomainException {
  return new DomainException(ErrorCode.PROJECT_NODE_LIMIT_REACHED, 'Structure limit reached', {
    kind,
    limit,
  });
}
