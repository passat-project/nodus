import { ErrorCode, type OrgUnitKind } from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';

/** Корневые инварианты оргструктуры (#982, #1028): management-корень один —
 *  это главная карточка компании; юридическая структура — лес корней, там
 *  открепление и несколько корней законны. Правила собраны здесь, чтобы
 *  create/update/archive ссылались на один канон, а не на три копии. */

/** Минимальное зеркало узла подразделения для проверок корня. */
export type RootPolicyNode = {
  kind: OrgUnitKind;
  parentId: string | null;
};

/** #982/#1028: узел (или dto создания) — management-корень. */
export function isManagementRoot(kind: OrgUnitKind, parentId: string | null): boolean {
  return kind === 'management' && parentId === null;
}

/** #1028: корень управленческой структуры один. Второй параллельный POST под
 *  локом дерева видит уже созданный корень и получает отказ; раньше правило
 *  держал только PATCH, и второй корень можно было создать. */
export async function assertSingleManagementRoot(
  kind: OrgUnitKind,
  countRoots: () => Promise<number>,
): Promise<void> {
  if ((await countRoots()) > 0) {
    throw new DomainException(
      ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
      'Management department root already exists',
      { kind, reason: 'second_root' },
    );
  }
}

/** #982: управленческое подразделение не открепляется в корень — корень один,
 *  главная карточка компании. Это ОТКАЗ, а не перенос. */
export function assertNotDetachedToRoot(node: RootPolicyNode, id: string): void {
  if (node.kind === 'management' && node.parentId !== null) {
    throw new DomainException(
      ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
      'Management department cannot be detached to root',
      { id },
    );
  }
}

/** #1028: главную карточку компании не архивируем (вердикт 12.11) — правило
 *  жило только в UI, сервер обязан отказать (I8). */
export function assertRootNotArchivable(node: RootPolicyNode, id: string): void {
  if (node.kind === 'management' && node.parentId === null) {
    throw new DomainException(
      ErrorCode.DIRECTORY_DEPARTMENT_ROOT_FORBIDDEN,
      'Management department root cannot be archived',
      { id, reason: 'root' },
    );
  }
}
