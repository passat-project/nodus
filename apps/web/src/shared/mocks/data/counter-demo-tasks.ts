import type { TaskListItem } from '@nodus/contracts';

import { isoAgo, isoIn } from './dates.js';
import { nodeIds } from './project-node-ids.js';
import { mk, projectRefs, tid } from './task-item-factory.js';
import { stageInProgress } from './task-stages.js';
import { changeTypeRef } from './workflows.js';
import { userIds, userRef } from './users.js';

/** Демо счётчиков (#630, модель v3): работы «Изменение» в РЕАЛЬНЫХ папках
 *  «Комплект» проекта p4. КЖ-01 при создании выдал «Изм. 1» и «Изм. 2»
 *  (книга — 15-26, 16-26), КЖ-02 — «Изм. 1» (17-26): новая работа в КЖ-01
 *  получит «Изм. 3» и «18-26». Работы «без комплекта» и «по ОВ» созданы ДО
 *  настройки счётчиков — номеров нет: их видно в охвате и в «Выдать номера
 *  существующим»; у проекта второй нет Инв. № — «Выдать в печать» спросит,
 *  выдать ли накладную без него. */
const base = {
  type: changeTypeRef,
  stage: stageInProgress,
  priority: 'normal' as const,
  creator: userRef(userIds.klimovich),
  assignee: userRef(userIds.klimovich),
  participants: [],
  project: projectRefs.p4,
  parentId: null,
  spentMinutes: 0,
  commentsCount: 0,
  checklistDone: 0,
  checklistTotal: 0,
  source: 'manual' as const,
};

export const counterDemoTasks: TaskListItem[] = [
  mk({
    ...base,
    id: tid(630),
    number: 9630,
    title: 'Изменение КЖ-01: отверстия в плите',
    deadline: isoIn(2),
    nodeId: nodeIds.kzh01,
    updatedAt: isoAgo(3, 10, 0),
  }),
  mk({
    ...base,
    id: tid(631),
    number: 9631,
    title: 'Изменение КЖ-01: армирование ростверка',
    deadline: isoIn(4),
    nodeId: nodeIds.kzh01,
    updatedAt: isoAgo(0, 9, 40),
  }),
  mk({
    ...base,
    id: tid(632),
    number: 9632,
    title: 'Изменение КЖ-02: закладные детали',
    deadline: isoIn(6),
    nodeId: nodeIds.kzh02,
    updatedAt: isoAgo(0, 9, 20),
  }),
  mk({
    ...base,
    id: tid(633),
    number: 9633,
    title: 'Изменение без комплекта: план кровли',
    deadline: isoIn(7),
    nodeId: nodeIds.b2ar,
    updatedAt: isoAgo(0, 8, 50),
  }),
  mk({
    ...base,
    id: tid(634),
    number: 9634,
    title: 'Изменение ОВ: трассы вентиляции',
    deadline: isoIn(9),
    project: projectRefs.p1,
    nodeId: null,
    updatedAt: isoAgo(0, 8, 30),
  }),
];
