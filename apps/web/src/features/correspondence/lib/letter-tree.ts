import type { LetterRelationKind, LetterTreeNode, LetterTreeResponse } from '@nodus/contracts';

/**
 * Дерево «ёлочки» (#461, Р2) — чистые операции над серверным ответом
 * `GET /letters/:id/tree` для оптимистичных мутаций связей (I4): вставка
 * нового узла под источником, замена связи того же вида и снятие по id.
 * Серверный ответ — истина; после мутации дерево рефетчится.
 */

export function findTreeNode(root: LetterTreeNode, id: string): LetterTreeNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findTreeNode(child, id);
    if (found) return found;
  }
  return null;
}

/** Узел дерева из строки списка (цель окна «Добавить связь»). */
export function treeNodeOf(target: {
  id: string;
  regNumber: string | null;
  theirNumber: string | null;
  subject: string | null;
  direction: LetterTreeNode['direction'];
  stage: { systemState: LetterTreeNode['systemState'] };
  confidential: boolean;
}): LetterTreeNode {
  return {
    id: target.id,
    regNumber: target.regNumber,
    theirNumber: target.theirNumber,
    subject: target.subject,
    direction: target.direction,
    systemState: target.stage.systemState,
    confidential: target.confidential,
    relationId: null,
    relationKind: null,
    children: [],
  };
}

/** Ветка без вхождений письма `id` по связи вида `kind` (у письма одна
 *  связь каждого вида; по второй связи оно остаётся на своём месте —
 *  письмо с двумя связями стоит в дереве дважды). */
function withoutLink(
  current: LetterTreeNode,
  id: string,
  kind: LetterRelationKind,
): LetterTreeNode {
  return {
    ...current,
    children: current.children
      .filter((child) => child.id !== id || child.relationKind !== kind)
      .map((child) => withoutLink(child, id, kind)),
  };
}

/** Узел `id` получает ребёнка `child` (дети: вложенные, затем ответы —
 *  порядок сервера). */
function withChild(current: LetterTreeNode, id: string, child: LetterTreeNode): LetterTreeNode {
  if (current.id === id) {
    const children = [...current.children, child];
    const order = (node: LetterTreeNode) => (node.relationKind === 'nested_in' ? 0 : 1);
    return { ...current, children: children.sort((a, b) => order(a) - order(b)) };
  }
  return { ...current, children: current.children.map((next) => withChild(next, id, child)) };
}

/** Связь поставлена: в дереве дети узла — письма, у которых на него
 *  `reply_to`/`nested_in`, поэтому ЦЕЛЬ становится родителем источника.
 *  Цель уже в дереве — источник с поддеревом переезжает под неё (остальная
 *  цепочка на месте, без вспышки «пустого» дерева); источник — верх
 *  цепочки, а цели в дереве нет — цель становится новым верхом. Прочее
 *  (источник в середине, цель снаружи) оптимистично не трогаем: где
 *  встанет ветка, решает сервер (конверт приоритетнее ответа) — рефетч.
 *  Цель внутри ветки источника — круг, сервер откажет (422): не трогаем. */
export function withRelation(
  tree: LetterTreeResponse,
  sourceId: string,
  target: LetterTreeNode,
  kind: LetterRelationKind,
): LetterTreeResponse {
  const source = findTreeNode(tree.root, sourceId);
  if (!source || target.id === sourceId) return tree;
  const moved: LetterTreeNode = { ...source, relationKind: kind, relationId: null };
  if (findTreeNode(source, target.id)) return tree;
  if (findTreeNode(tree.root, target.id)) {
    return { ...tree, root: withChild(withoutLink(tree.root, sourceId, kind), target.id, moved) };
  }
  if (sourceId !== tree.root.id) return tree;
  return {
    ...tree,
    root: { ...target, relationKind: null, relationId: null, children: [moved] },
  };
}

/** Строка «ёлочки» в плоском порядке отрисовки (DFS) — геометрия графа. */
export interface LetterTreeRow {
  node: LetterTreeNode;
  /** Ключ строки: id связи с родителем (письмо с двумя связями стоит в
   *  дереве дважды — id письма не уникален), у корня — `root`. */
  key: string;
  depth: number;
  hasChildren: boolean;
  /** Всего потомков — счётчик свёрнутой ветки. */
  descendants: number;
}

/** Плоский список видимых строк с учётом свёрнутых веток (ключи строк). */
export function flattenLetterTree(
  root: LetterTreeNode,
  collapsed: ReadonlySet<string>,
): LetterTreeRow[] {
  const rows: LetterTreeRow[] = [];
  const walk = (node: LetterTreeNode, depth: number, hidden: boolean) => {
    const key = node.relationId ?? 'root';
    const row: LetterTreeRow = {
      node,
      key,
      depth,
      hasChildren: node.children.length > 0,
      descendants: treeNodeCount(node) - 1,
    };
    if (!hidden) rows.push(row);
    const childrenHidden = hidden || collapsed.has(key);
    for (const child of node.children) walk(child, depth + 1, childrenHidden);
  };
  walk(root, 0, false);
  return rows;
}

/** Связь снята: узел с этим relationId уходит вместе с поддеревом. */
export function withoutRelation(tree: LetterTreeResponse, relationId: string): LetterTreeResponse {
  const prune = (current: LetterTreeNode): LetterTreeNode => ({
    ...current,
    children: current.children.filter((child) => child.relationId !== relationId).map(prune),
  });
  return { ...tree, root: prune(tree.root) };
}

/** Число узлов — для счётчика панели. */
export function treeNodeCount(root: LetterTreeNode): number {
  return 1 + root.children.reduce((sum, child) => sum + treeNodeCount(child), 0);
}
