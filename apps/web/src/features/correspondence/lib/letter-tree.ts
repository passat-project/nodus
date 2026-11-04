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

/** Связь поставлена: в дереве дети узла — письма, у которых на него
 *  `reply_to`/`nested_in`, поэтому ЦЕЛЬ становится родителем источника.
 *  Источник переподчиняется под цель, цель — новый верх цепочки (её
 *  собственные родители из строки списка неизвестны; рефетч уточнит).
 *  Старая связь источника того же вида отпадает — у письма одна связь
 *  каждого вида. Источника нет в дереве — оптимистично ничего не меняем. */
export function withRelation(
  tree: LetterTreeResponse,
  sourceId: string,
  target: LetterTreeNode,
  kind: LetterRelationKind,
): LetterTreeResponse {
  const source = findTreeNode(tree.root, sourceId);
  if (!source || target.id === sourceId) return tree;
  return {
    ...tree,
    root: {
      ...target,
      relationKind: null,
      relationId: null,
      children: [{ ...source, relationKind: kind, relationId: null }],
    },
  };
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
