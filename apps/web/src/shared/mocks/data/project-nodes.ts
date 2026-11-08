import type { NodeKind, ProjectNode, ProjectNodeRollup } from '@nodus/contracts';
import { isCompletedState, isOpenState, NODE_LIMITS } from '@nodus/contracts';

import { SYSTEM_FIELD_IDS } from '@nodus/contracts';
import { MARKA_FIELD_ID, SET_MARK_OV_ID } from './set-marks.js';

import { isoAgo } from './dates.js';
import { fieldIds } from './field-ids.js';
import { nodeKindSeedIds } from './node-kind-ids.js';
import { nodeIds } from './project-node-ids.js';
import { demoTasks } from './tasks.js';
import { projectRefs } from './task-item-factory.js';

/** Структура демо-проектов (#467, #556): виды папок (справочник
 *  «Автоматизации», посев по ТКП 45-1.02-295 + «Комплект») и папки
 *  демо-проекта p4. Rollup-агрегаты папки считаются по ПРЯМЫМ задачам
 *  (tasks.nodeId) при каждом чтении — структура всегда отвечает свежим
 *  срезом мок-мира. Порядок сиблингов = порядок строк в массиве. */

const kindId = (n: number): string => `44000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const defaultForm = { fields: [] };

/** Виды папок — настраиваемые типы (#556): форма и возможности. */
export const nodeKindIds = {
  stage: kindId(1),
  queue: kindId(2),
  startup: kindId(3),
  // «Здание по генплану» и «Комплект» — из лист-модуля (#632): те же id
  // нужны формулам маршрутов, которые не могут импортировать этот файл.
  building: nodeKindSeedIds.building,
  section: kindId(5),
  phase: kindId(6),
  komplekt: nodeKindSeedIds.komplekt,
} as const;

export const demoNodeKinds: NodeKind[] = [
  {
    id: nodeKindIds.stage,
    name: 'Стадия',
    icon: 'layers',
    color: 'amber',
    archivedAt: null,
    form: defaultForm,
    capabilities: [],
  },
  {
    id: nodeKindIds.queue,
    name: 'Очередь',
    icon: 'route',
    color: 'blue',
    archivedAt: null,
    form: defaultForm,
    capabilities: [],
  },
  {
    id: nodeKindIds.startup,
    name: 'Пусковой комплекс',
    icon: 'milestone',
    color: 'green',
    archivedAt: null,
    form: defaultForm,
    capabilities: [],
  },
  {
    id: nodeKindIds.building,
    name: 'Здание по генплану',
    icon: 'building',
    color: 'sky',
    archivedAt: null,
    // «№ по ГП» (#632) — посевной атрибут вида: формула шифра комплекта
    // читает его у ближайшей папки-здания. Слот = привязка (инвариант мока).
    form: { fields: [{ fieldId: fieldIds.buildingGp, state: 'optional' }] },
    capabilities: [],
  },
  {
    id: nodeKindIds.section,
    name: 'Раздел',
    icon: 'listTree',
    color: 'pink',
    archivedAt: null,
    form: defaultForm,
    capabilities: [],
  },
  {
    id: nodeKindIds.phase,
    name: 'Этап',
    icon: 'flag',
    color: 'terra',
    archivedAt: null,
    form: defaultForm,
    capabilities: [],
  },
  // Посевной «Комплект» (#556): шифр обязателен (В1), «Марка» обязательна,
  // все три возможности включены. Мок повторяет миграцию Б.
  {
    id: nodeKindIds.komplekt,
    name: 'Комплект',
    icon: 'fileText',
    color: 'blue',
    archivedAt: null,
    // «Код» — посевной атрибут в слоте (бывший form.code, Р9 #631).
    form: {
      fields: [
        { fieldId: SYSTEM_FIELD_IDS.nodeCode, state: 'required' },
        { fieldId: MARKA_FIELD_ID, state: 'required' },
      ],
    },
    capabilities: ['document_changes', 'pulse_row', 'schema_row'],
  },
];

/** Строка узла мок-мира (до гидратации rollup). */
export interface DemoNodeRow {
  id: string;
  projectId: string;
  parentId: string | null;
  kindId: string;
  name: string;
  code: string | null;
  customFields: Record<
    string,
    string | number | boolean | string[] | { amount: number; currencyId: string }
  >;
  createdAt: string;
}

/** Дерево демо-проекта p4 «Главный корпус галургической фабрики»:
 *  Здание 1 → разделы АР/КР/ИОС + комплект ОВ1.1, Здание 2 → АР (модель
 *  «папки в проводнике»). «Комплект» (#556) — папка-документ с маркой. */
export const demoNodeRows: DemoNodeRow[] = [
  {
    id: nodeIds.b1,
    projectId: projectRefs.p4.id,
    parentId: null,
    kindId: nodeKindIds.building,
    name: 'Здание 1',
    code: null,
    // «№ по ГП» (#632): шифр комплекта собирается как
    // «шифр проекта — № по ГП — марка номер».
    customFields: { [fieldIds.buildingGp]: '1' },
    createdAt: isoAgo(80),
  },
  {
    id: nodeIds.b1ar,
    projectId: projectRefs.p4.id,
    parentId: nodeIds.b1,
    kindId: nodeKindIds.section,
    name: 'Архитектурные решения',
    code: 'АР',
    customFields: { [SYSTEM_FIELD_IDS.nodeCode]: 'АР' },
    createdAt: isoAgo(79),
  },
  {
    id: nodeIds.b1kr,
    projectId: projectRefs.p4.id,
    parentId: nodeIds.b1,
    kindId: nodeKindIds.section,
    name: 'Конструктивные решения',
    code: 'КР',
    customFields: { [SYSTEM_FIELD_IDS.nodeCode]: 'КР' },
    createdAt: isoAgo(78),
  },
  {
    id: nodeIds.b1ios,
    projectId: projectRefs.p4.id,
    parentId: nodeIds.b1,
    kindId: nodeKindIds.section,
    name: 'Инженерное обеспечение',
    code: 'ИОС',
    customFields: { [SYSTEM_FIELD_IDS.nodeCode]: 'ИОС' },
    createdAt: isoAgo(77),
  },
  {
    id: nodeIds.ov11,
    projectId: projectRefs.p4.id,
    parentId: nodeIds.b1ios,
    kindId: nodeKindIds.komplekt,
    name: 'ОВ1.1',
    code: 'ОВ1.1',
    customFields: { [MARKA_FIELD_ID]: SET_MARK_OV_ID, [SYSTEM_FIELD_IDS.nodeCode]: 'ОВ1.1' },
    createdAt: isoAgo(76),
  },
  // Комплекты КЖ (#630): работы «Изменение» внутри — свой счёт «Изм.».
  {
    id: nodeIds.kzh01,
    projectId: projectRefs.p4.id,
    parentId: nodeIds.b1kr,
    kindId: nodeKindIds.komplekt,
    name: 'КЖ-01',
    code: 'КЖ-01',
    customFields: { [SYSTEM_FIELD_IDS.nodeCode]: 'КЖ-01', [fieldIds.komplektSeq]: 'К-01' },
    createdAt: isoAgo(70),
  },
  {
    id: nodeIds.kzh02,
    projectId: projectRefs.p4.id,
    parentId: nodeIds.b1kr,
    kindId: nodeKindIds.komplekt,
    name: 'КЖ-02',
    code: 'КЖ-02',
    customFields: { [SYSTEM_FIELD_IDS.nodeCode]: 'КЖ-02', [fieldIds.komplektSeq]: 'К-02' },
    createdAt: isoAgo(69),
  },
  {
    id: nodeIds.b2,
    projectId: projectRefs.p4.id,
    parentId: null,
    kindId: nodeKindIds.building,
    name: 'Здание 2',
    code: null,
    customFields: {},
    createdAt: isoAgo(50),
  },
  {
    id: nodeIds.b2ar,
    projectId: projectRefs.p4.id,
    parentId: nodeIds.b2,
    kindId: nodeKindIds.section,
    name: 'Архитектурные решения',
    code: 'АР',
    customFields: { [SYSTEM_FIELD_IDS.nodeCode]: 'АР' },
    createdAt: isoAgo(49),
  },
];

export function findDemoNodeRow(id: string): DemoNodeRow | undefined {
  return demoNodeRows.find((row) => row.id === id);
}

export function nodesOfProject(projectId: string): DemoNodeRow[] {
  return demoNodeRows.filter((row) => row.projectId === projectId);
}

/** Прямые задачи узла (листья дерева, tasks.nodeId). */
export function directTasksOf(nodeId: string) {
  return demoTasks.filter((task) => task.nodeId === nodeId);
}

/** Агрегаты ПРЯМЫХ задач узла (порт TASK_PROJECT_READER.nodeRollups):
 *  nearest — MIN(deadline) открытых, latest — MAX(deadline) всех. */
export function rollupOfNode(nodeId: string): ProjectNodeRollup {
  const tasks = directTasksOf(nodeId);
  const withDeadline = tasks.filter((t) => t.deadline !== null);
  const openDeadlines = tasks
    .filter((t) => t.deadline !== null && isOpenState(t.stage.systemState))
    .map((t) => t.deadline as string);
  return {
    taskCount: tasks.length,
    doneCount: tasks.filter((t) => isCompletedState(t.stage.systemState, t.stage.outcome)).length,
    plannedMinutes: tasks.reduce((sum, t) => sum + (t.plannedMinutes ?? 0), 0),
    spentMinutes: tasks.reduce((sum, t) => sum + t.spentMinutes, 0),
    nearestDeadline:
      openDeadlines.length > 0 ? openDeadlines.reduce((a, b) => (a < b ? a : b)) : null,
    latestDeadline:
      withDeadline.length > 0
        ? withDeadline.map((t) => t.deadline as string).reduce((a, b) => (a > b ? a : b))
        : null,
  };
}

export function projectNodeDto(row: DemoNodeRow): ProjectNode {
  // Код — производная системного атрибута (как серверный `nodeToDto`);
  // колонка row.code осталась только у старых сидов.
  const code = row.customFields[SYSTEM_FIELD_IDS.nodeCode];
  return {
    id: row.id,
    parentId: row.parentId,
    kindId: row.kindId,
    name: row.name,
    code: typeof code === 'string' && code.trim().length > 0 ? code : null,
    customFields: row.customFields,
    rollup: rollupOfNode(row.id),
    createdAt: row.createdAt,
  };
}

/** Сводка структуры для карточки проекта (дефолт вкладки: «Структура»
 *  первична, когда есть узел с прямыми задачами-детьми). */
export function structureSummaryOf(projectId: string): {
  nodeCount: number;
  hasTaskNodes: boolean;
} {
  const nodes = nodesOfProject(projectId);
  return {
    nodeCount: nodes.length,
    hasTaskNodes: nodes.some((node) => directTasksOf(node.id).length > 0),
  };
}

/** Дети узла (null — корни) в порядке массива (порядок сиблингов =
 *  позиция в demoNodeRows). */
export function childNodeRows(parentId: string | null, projectId: string): DemoNodeRow[] {
  return demoNodeRows.filter((row) => row.projectId === projectId && row.parentId === parentId);
}

/** Все потомки узла (для блокировки циклов при переносе). */
export function descendantIdsOf(nodeId: string): Set<string> {
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const row of demoNodeRows) {
      if (row.parentId === id && !out.has(row.id)) {
        out.add(row.id);
        walk(row.id);
      }
    }
  };
  walk(nodeId);
  return out;
}

/** Глубина узла от корня (лимит NODE_LIMITS.depth). */
export function nodeDepthOf(row: DemoNodeRow): number {
  let depth = 0;
  let current: DemoNodeRow | undefined = row;
  while (current?.parentId) {
    current = findDemoNodeRow(current.parentId);
    depth += 1;
    if (depth > NODE_LIMITS.depth) break;
  }
  return depth;
}
