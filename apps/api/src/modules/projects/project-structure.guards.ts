import { ErrorCode, kindAllowedByType, type NodeKind } from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import type { NodeKindsRepository } from './project-node-kinds.repository.js';
import type { ProjectNodesRepository } from './project-nodes.repository.js';
import type { ProjectTypesRepository } from './project-types.repository.js';
import { nodeInvalid, type TreeNodeLike } from './project-structure.tree.js';

/**
 * Гарды структуры (#467, #556): вид папки для создания/смены (живой и
 * допустимый типу проекта), вид существующей папки (архивный допустим),
 * родитель и уникальность шифра. Вынесены из сервиса — I5.
 */

/** Живой и допустимый типу проекта вид: архивный — 409, чужой типу — 422. */
export async function assertKindAlive(
  kinds: NodeKindsRepository,
  types: ProjectTypesRepository,
  tx: TransactionClient,
  typeId: string,
  kindId: string,
): Promise<NodeKind> {
  // FOR SHARE: архивация вида ждёт коммита создания папки (и наоборот) —
  // папка не создастся с видом, заархивированным в ту же миллисекунду.
  const kind = await kinds.findActiveForShare(tx, kindId);
  if (!kind) {
    if (await kinds.findById(kindId, tx)) {
      throw new DomainException(ErrorCode.PROJECT_NODE_KIND_ARCHIVED, 'Node kind is archived', {
        kindId,
      });
    }
    throw new DomainException(ErrorCode.PROJECT_NODE_INVALID, 'Node kind is not available', {
      kindId,
    });
  }
  const type = await types.findById(typeId);
  if (type && !kindAllowedByType(type.kindIds, kindId)) {
    throw new DomainException(
      ErrorCode.PROJECT_NODE_KIND_NOT_ALLOWED,
      'Node kind is not allowed for this project type',
      { kindId, typeId },
    );
  }
  return kind;
}

/** Вид существующей папки: архивный допустим (папка живёт), удалённый — 422. */
export async function kindOf(
  kinds: NodeKindsRepository,
  tx: TransactionClient,
  kindId: string,
): Promise<NodeKind> {
  const kind = await kinds.findById(kindId, tx);
  if (kind) return kind;
  throw new DomainException(ErrorCode.PROJECT_NODE_INVALID, 'Node kind is not available', {
    kindId,
  });
}

export function assertParent(
  tree: readonly TreeNodeLike[],
  parentId: string | null,
): TreeNodeLike | null {
  if (parentId === null) return null;
  const parent = tree.find((entry) => entry.id === parentId);
  if (!parent) throw nodeInvalid(parentId);
  return parent;
}

/** Шифр папки уникален в проекте (зеркало частичного unique). */
export async function assertCodeFree(
  nodes: ProjectNodesRepository,
  tx: TransactionClient,
  projectId: string,
  code: string,
  excludeId: string | null,
): Promise<void> {
  if (await nodes.codeTaken(projectId, code, excludeId, tx)) {
    throw new DomainException(
      ErrorCode.PROJECT_NODE_CODE_TAKEN,
      'Node code is already taken in this project',
      { code },
    );
  }
}
