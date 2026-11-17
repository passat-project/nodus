import type { DepartmentNode, UpdateDepartmentDto } from '@nodus/contracts';

/** Чистые операции над деревом подразделений (#84, #768): UI-виды и
 *  оптимистичные мутации кэша (I4) — из этих функций, без состояния. */

/** Путь от корня до узла включительно (для раскрытия предков при центрировании
 *  и выбора из поиска) или null. */
export function departmentPath(roots: DepartmentNode[], id: string): DepartmentNode[] | null {
  for (const node of roots) {
    if (node.id === id) return [node];
    const inner = departmentPath(node.children, id);
    if (inner) return [node, ...inner];
  }
  return null;
}

/** Узел по id (панель подразделения) или null. */
export function findDepartment(roots: DepartmentNode[], id: string): DepartmentNode | null {
  return departmentPath(roots, id)?.at(-1) ?? null;
}

/** Ребро «откуда → куда» следа спуска в структуре (#768). */
export interface DepartmentLink {
  parent: string;
  child: string;
}

/** Маршрут от корня до выбранного подразделения рёбрами — по нему бежит
 *  точка-импульс и остаётся закрашенный след (`StructureTrace`). */
export function departmentTrail(roots: DepartmentNode[], id: string): DepartmentLink[] {
  const path = departmentPath(roots, id);
  if (!path || path.length < 2) return [];
  return path.slice(0, -1).map((node, index) => ({
    parent: node.id,
    child: path[index + 1]!.id,
  }));
}

/**
 * Цепочка раскрытий после клика по узлу (#768, вердикт 15.11.2026): индекс —
 * глубина узла, значение — раскрытый на этом уровне узел. Клик по уже
 * раскрытому предку глубокие уровни НЕ срезает (модель Битрикса), клик по
 * соседу на том же уровне — срезает всё глубже него.
 */
export function keepChain(chain: string[], depth: number, id: string): string[] {
  if (chain[depth] === id) return chain;
  return [...chain.slice(0, depth), id];
}

/** Оптимистичная вставка узла (кэш дерева, I4): parentId null — новый корень. */
export function insertDepartment(roots: DepartmentNode[], node: DepartmentNode): DepartmentNode[] {
  if (node.parentId === null) return [...roots, node];
  const walk = (current: DepartmentNode): DepartmentNode =>
    current.id === node.parentId
      ? { ...current, children: [...current.children, node] }
      : { ...current, children: current.children.map(walk) };
  return roots.map(walk);
}

/** Оптимистичный патч узла (кэш дерева, I4); денормализованные имена и счётчики
 *  доносит инвалидация после ответа сервера. */
export function patchDepartment(
  roots: DepartmentNode[],
  id: string,
  patch: UpdateDepartmentDto,
): DepartmentNode[] {
  const walk = (current: DepartmentNode): DepartmentNode => {
    const next =
      current.id === id
        ? {
            ...current,
            ...patch,
            parentId: patch.parentId === undefined ? current.parentId : patch.parentId,
          }
        : current;
    return { ...next, children: next.children.map(walk) };
  };
  return roots.map(walk);
}
