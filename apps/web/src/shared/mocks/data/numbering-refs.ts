import type { NumberContainerHit, NumberContainerRef, NumberIssuer } from '@nodus/contracts';

import { findDemoNodeRow } from './project-nodes.js';
import { demoProjectGroups, demoProjectRows, demoProjectTypes } from './projects.js';
import { demoTasks } from './tasks.js';
import { demoWorkflowDetails } from './workflows.js';

/** Ссылки мок-мира счётчиков (#630): имена значений условий и кнопки-
 *  выдатчики — то, что сервер читает из дерева и опубликованных маршрутов.
 *  Вынесено из `numbering-store.ts` (I5): стор держит только счета и журнал. */

/** Кнопки опубликованных маршрутов, выдающие номер атрибута. */
export function mockIssuers(fieldId: string): NumberIssuer[] {
  const out: NumberIssuer[] = [];
  for (const detail of Object.values(demoWorkflowDetails)) {
    for (const transition of detail.document.transitions) {
      const issues = transition.rules.postFunctions.some(
        (pf) => pf.kind === 'assign_number' && pf.fieldId === fieldId,
      );
      if (!issues) continue;
      for (const typeId of detail.typeIds) {
        out.push({
          processTypeId: typeId,
          transitionId: transition.id,
          transitionName: transition.name,
        });
      }
    }
  }
  return out;
}

/** Значение условия, как его видит администратор: имя и путь по дереву. */
export function mockContainerRef(hit: NumberContainerHit): NumberContainerRef {
  const ref = (name: string, path: string[] = [], deleted = false): NumberContainerRef => ({
    entity: hit.entity,
    id: hit.id,
    name,
    path,
    hidden: false,
    deleted,
  });
  switch (hit.entity) {
    case 'node': {
      const node = findDemoNodeRow(hit.id);
      if (!node) return ref('Папка', [], true);
      const path: string[] = [];
      let parent = node.parentId ? findDemoNodeRow(node.parentId) : undefined;
      while (parent) {
        path.unshift(parent.name);
        parent = parent.parentId ? findDemoNodeRow(parent.parentId) : undefined;
      }
      const project = demoProjectRows.find((row) => row.id === node.projectId);
      return ref(node.name, project ? [project.name, ...path] : path);
    }
    case 'project':
      return ref(demoProjectRows.find((row) => row.id === hit.id)?.name ?? 'Проект');
    case 'project_type':
      return ref(demoProjectTypes.find((type) => type.id === hit.id)?.name ?? 'Тип проекта');
    case 'portfolio':
      return ref(demoProjectGroups.find((group) => group.id === hit.id)?.name ?? 'Портфель');
    case 'task':
      return ref(demoTasks.find((task) => task.id === hit.id)?.title ?? 'Задача');
    case 'type':
      return ref(hit.id);
    case 'value':
      return ref(hit.id);
  }
}
