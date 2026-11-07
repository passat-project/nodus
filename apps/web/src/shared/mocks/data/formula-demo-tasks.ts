import type { TaskListItem } from '@nodus/contracts';

import { isoAgo, isoIn } from './dates.js';
import { nodeIds } from './project-node-ids.js';
import { mk, projectRefs, tid } from './task-item-factory.js';
import { stageInProgress, stageNew } from './task-stages.js';
import { komplektTypeRef } from './workflows.js';
import { userIds, userRef } from './users.js';

/** Демо формул (#632): два комплекта типа «Комплект» в папке «Здание 1».
 *  Своего «Шифра комплекта» нет — его считает формула типа из шифра
 *  проекта, «№ по ГП» папки-здания, марки и номера комплекта. */
export const formulaDemoTasks: TaskListItem[] = [
  // Демо формул (#632): два комплекта типа «Комплект» в папке «Здание 1».
  // Своего «Шифра комплекта» нет — его считает формула типа из шифра
  // проекта, «№ по ГП» папки-здания, марки и номера комплекта.
  mk({
    id: tid(14),
    number: 114,
    title: 'Комплект КЖ: армирование фундаментов',
    type: komplektTypeRef,
    stage: stageInProgress,
    priority: 'normal',
    deadline: isoIn(5),
    creator: userRef(userIds.klimovich),
    assignee: userRef(userIds.matorin),
    participants: [],
    project: projectRefs.p4,
    parentId: null,
    // Папка «Здание 1» — ближайшая папка вида «Здание по генплану».
    nodeId: nodeIds.b1,
    spentMinutes: 0,
    commentsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    source: 'manual',
    updatedAt: isoAgo(0, 10, 20),
  }),
  mk({
    id: tid(15),
    number: 115,
    title: 'Комплект КМ: каркас покрытия',
    type: komplektTypeRef,
    stage: stageNew,
    priority: 'normal',
    deadline: isoIn(8),
    creator: userRef(userIds.klimovich),
    assignee: userRef(userIds.klimovich),
    participants: [],
    project: projectRefs.p4,
    parentId: null,
    nodeId: nodeIds.b1,
    spentMinutes: 0,
    commentsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    source: 'manual',
    updatedAt: isoAgo(1, 9, 5),
  }),
];
