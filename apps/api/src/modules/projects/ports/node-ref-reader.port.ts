import type { InjectionToken } from '@nestjs/common';

/**
 * Read-порт узлов структуры для ссылок-значений атрибутов (Р5 #631):
 * валидатор и гидратор модуля custom-fields проверяют цель-папку и читают
 * её название через порт (I3). Критерий — план #631 §6: узел существует и
 * ПРОЕКТ виден актёру (тот же, что у project-значений: секретный проект —
 * участие или view_secret, 404 без оракула).
 */
export const NODE_REF_READER: InjectionToken = 'NODE_REF_READER';

export interface NodeRefInfo {
  id: string;
  name: string;
  /** Узлы не архивируются (физическое удаление) — всегда false. */
  deleted: boolean;
}

export interface NodeRefReader {
  /** Узлы по id (удалённого нет — пусто в ответе). */
  refs(nodeIds: readonly string[]): Promise<NodeRefInfo[]>;

  /** Видим ли узел актёру: существует и проект виден (участие/надзор). */
  visibleFor(
    nodeId: string,
    viewer: { id: string; permissions: readonly string[] },
  ): Promise<boolean>;
}
