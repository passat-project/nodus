import type { TaskListItem } from '@nodus/contracts';

import { isoAgo, isoIn } from './dates.js';
import { nodeIds } from './project-node-ids.js';
import { mk, projectRefs, tid } from './task-item-factory.js';
import {
  requestProcessType,
  requestReviewStage,
  stageInProgress,
  systemProcessType,
} from './task-stages.js';
import { userIds, userRef } from './users.js';

/** Демо-задачи коллективной кнопки (#434): обычная задача с несколькими
 *  соисполнителями и «Заявка» на всех сотрудников. */
export const pressDemoTasks: TaskListItem[] = [
  mk({
    id: tid(17),
    number: 117,
    title: 'Согласовать отчёты по разделу ОВ1',
    type: systemProcessType,
    stage: stageInProgress,
    priority: 'high',
    deadline: isoIn(1),
    creator: userRef(userIds.matorin),
    assignee: userRef(userIds.matorin),
    participants: [
      userRef(userIds.klimovich),
      userRef(userIds.polomar),
      userRef(userIds.voronina),
      userRef(userIds.karpovich),
      userRef(userIds.akulich),
    ],
    project: projectRefs.p4,
    parentId: null,
    nodeId: nodeIds.b1ar,
    spentMinutes: 0,
    commentsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    source: 'manual',
    updatedAt: isoAgo(0, 5),
  }),
  mk({
    id: tid(18),
    number: 118,
    title: 'Заявка: ознакомиться с регламентом',
    type: requestProcessType,
    stage: requestReviewStage,
    priority: 'normal',
    deadline: isoIn(2),
    creator: userRef(userIds.matorin),
    assignee: userRef(userIds.matorin),
    participants: [userRef(userIds.klimovich)],
    project: null,
    parentId: null,
    nodeId: null,
    spentMinutes: 0,
    commentsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    source: 'manual',
    updatedAt: isoAgo(0, 4),
  }),
  mk({
    id: tid(19),
    number: 119,
    title: 'Заявка: ознакомиться с приказом',
    type: requestProcessType,
    stage: requestReviewStage,
    priority: 'high',
    deadline: isoIn(1),
    creator: userRef(userIds.matorin),
    assignee: userRef(userIds.matorin),
    participants: [userRef(userIds.klimovich)],
    project: null,
    parentId: null,
    nodeId: null,
    spentMinutes: 0,
    commentsCount: 0,
    checklistDone: 0,
    checklistTotal: 0,
    source: 'manual',
    updatedAt: isoAgo(0, 3),
  }),
];
