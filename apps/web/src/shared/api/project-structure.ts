import { useQuery } from '@tanstack/react-query';
import type { ProjectNode, ProjectStructureResponse } from '@nodus/contracts';

import { api } from '../api-client.js';
import { projectsKeys } from './projects-list.js';

/** Дерево структуры проекта (#467) — чтение для поля «Структура» в окне
 *  создания задачи. Живёт в shared: окно создания — shared/tasks и не может
 *  импортировать фичу проектов (I3). Ключ тот же, что у вкладки «Структура». */
export function useProjectStructure(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectsKeys.structure(projectId ?? ''),
    queryFn: () => api<ProjectStructureResponse>(`/projects/${projectId}/structure`),
    enabled: Boolean(projectId),
  });
}

/** Плоский список узлов с полным путём («Здание 1 / АР / Комплект АР-1») —
 *  компактный выбор структуры в окне создания задачи. */
export function projectNodePathOptions(nodes: ProjectNode[]): { id: string; label: string }[] {
  const byParent = new Map<string | null, ProjectNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const out: { id: string; label: string }[] = [];
  const walk = (parentId: string | null, path: string[]) => {
    for (const node of byParent.get(parentId) ?? []) {
      const next = [...path, node.name];
      out.push({ id: node.id, label: next.join(' / ') });
      walk(node.id, next);
    }
  };
  walk(null, []);
  return out;
}
