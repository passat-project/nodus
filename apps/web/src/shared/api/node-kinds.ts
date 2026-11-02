import { useQuery } from '@tanstack/react-query';
import type { NodeKind } from '@nodus/contracts';

import { api } from '../api-client.js';
import { projectsKeys } from './projects-list.js';

/**
 * Виды папок структуры (#556) — shared: потребители в фиче проектов
 * («Структура», «Свойства папки», «Создать папку») и в «Атрибутах» (область
 * «Папки»). Ключ под префиксом `projects` — инвалидации модуля достают всё;
 * каталожное событие `project.node_kind_changed` инвалидирует префикс.
 */
export const nodeKindsKeys = {
  all: [...projectsKeys.all, 'node-kinds'] as const,
  list: () => nodeKindsKeys.all,
};

/** Все виды папок (архивные в конце — порядок сервера). */
export function useNodeKinds() {
  return useQuery({
    queryKey: nodeKindsKeys.list(),
    queryFn: () => api<NodeKind[]>('/projects/node-kinds'),
  });
}

/** Вид папки по id из уже загруженного списка (терпимо к старому API). */
export function nodeKindById(
  kinds: readonly NodeKind[] | undefined,
  id: string | undefined,
): NodeKind | undefined {
  return id ? kinds?.find((kind) => kind.id === id) : undefined;
}
