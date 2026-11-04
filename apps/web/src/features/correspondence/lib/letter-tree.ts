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

/** Связь поставлена: узел встаёт ребёнком источника; при `replace` прежняя
 *  связь того же вида отсекается (у письма одна связь каждого вида). */
export function withRelation(
  tree: LetterTreeResponse,
  sourceId: string,
  node: LetterTreeNode,
  kind: LetterRelationKind,
  replace: boolean,
): LetterTreeResponse {
  const attach = (current: LetterTreeNode): LetterTreeNode => {
    if (current.id === sourceId) {
      const kept = replace
        ? current.children.filter((child) => child.relationKind !== kind)
        : current.children;
      return {
        ...current,
        children: [...kept, { ...node, relationKind: kind }],
      };
    }
    return { ...current, children: current.children.map(attach) };
  };
  return { ...tree, root: attach(tree.root) };
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
