import type {
  CustomFieldValues,
  ProjectColor,
  ProjectGroup,
  ProjectObserverKind,
  ProjectParticipantSource,
  ProjectStatus,
  ProjectVisibility,
} from '@nodus/contracts';
import { SYSTEM_FIELD_IDS } from '@nodus/contracts';

import { counterpartyIds } from './counterparties.js';
import { isoAgo, isoDateIn } from './dates.js';
import { fieldIds } from './field-ids.js';
import { typeId } from './project-types.js';
import { projectRefs } from './task-item-factory.js';
import { userIds } from './users.js';

export { demoProjectTypeIds, demoProjectTypes } from './project-types.js';

/** Строка проекта мок-мира (до гидратации ссылок и прав). */
export interface DemoProjectRow {
  id: string;
  code: string | null;
  name: string;
  description: string;
  color: ProjectColor;
  typeId: string;
  portfolioId: string | null;
  clientId: string | null;
  managerId: string;
  assistantIds: string[];
  visibility: ProjectVisibility;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  customFields: CustomFieldValues;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

/** Строка участия мок-мира (проект, сотрудник, источник). */
export interface DemoParticipantRow {
  projectId: string;
  userId: string;
  source: ProjectParticipantSource;
  observerKind: ProjectObserverKind | null;
  joinedAt: string;
}

const groupId = (n: number): string => `42000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const demoProjectGroups: ProjectGroup[] = [
  { id: groupId(1), name: 'Метро, линия 4', archivedAt: null },
  { id: groupId(2), name: 'ИТ-проекты', archivedAt: null },
  { id: groupId(3), name: 'Тендеры', archivedAt: null },
  { id: groupId(4), name: 'Архивные портфели', archivedAt: isoAgo(120) },
];

/** Демо-проекты: договоры с шифром, «темы» без шифра, секретные, архив. */
export const demoProjectRows: DemoProjectRow[] = [
  {
    id: projectRefs.p1.id,
    code: projectRefs.p1.code,
    name: 'Внедрение цифровых информационных технологий',
    description:
      'Договор на внедрение цифровых информационных технологий по объектам метрополитена.',
    color: projectRefs.p1.color,
    typeId: typeId(1),
    portfolioId: groupId(1),
    clientId: counterpartyIds.galurgiya,
    managerId: userIds.klimovich,
    assistantIds: [userIds.klevantovich],
    visibility: 'open',
    status: 'active',
    startDate: isoDateIn(-120),
    endDate: isoDateIn(240),
    completedAt: null,
    archivedAt: null,
    customFields: {},
    creatorId: userIds.klimovich,
    createdAt: isoAgo(120),
    updatedAt: isoAgo(0, 9, 30),
  },
  {
    id: projectRefs.p2.id,
    code: projectRefs.p2.code,
    name: 'Разработка плагина SmartCon',
    description: 'Внутренняя «тема»: разработка плагина конвертации SmartCon.',
    color: projectRefs.p2.color,
    typeId: typeId(2),
    portfolioId: groupId(2),
    clientId: null,
    managerId: userIds.klimovich,
    assistantIds: [],
    visibility: 'secret',
    status: 'active',
    startDate: isoDateIn(-60),
    endDate: null,
    completedAt: null,
    archivedAt: null,
    customFields: {},
    creatorId: userIds.klimovich,
    createdAt: isoAgo(60),
    updatedAt: isoAgo(1, 12, 0),
  },
  {
    id: projectRefs.p3.id,
    code: projectRefs.p3.code,
    name: 'Внедрение Revit',
    description: 'Перевод проектных групп на Revit, обучение и шаблоны.',
    color: projectRefs.p3.color,
    typeId: typeId(1),
    portfolioId: groupId(1),
    clientId: counterpartyIds.stroyzakazchik,
    managerId: userIds.klevantovich,
    assistantIds: [userIds.matorin],
    visibility: 'open',
    status: 'completed',
    startDate: isoDateIn(-300),
    endDate: isoDateIn(-10),
    completedAt: isoAgo(10),
    archivedAt: null,
    customFields: {},
    creatorId: userIds.klevantovich,
    createdAt: isoAgo(300),
    updatedAt: isoAgo(2, 8, 25),
  },
  {
    id: projectRefs.p4.id,
    code: projectRefs.p4.code,
    name: 'Главный корпус галургической фабрики',
    description: 'Секретный договор: проектирование главного корпуса галургической фабрики.',
    color: projectRefs.p4.color,
    typeId: typeId(1),
    portfolioId: groupId(1),
    clientId: counterpartyIds.galurgiya,
    managerId: userIds.vinnichek,
    assistantIds: [userIds.klimovich],
    visibility: 'secret',
    status: 'active',
    startDate: isoDateIn(-90),
    endDate: isoDateIn(120),
    completedAt: null,
    archivedAt: null,
    // «Шифр» (#632): формула шифра комплекта читает его у проекта; «Инв. №»
    // (#630) — вставка в номер накладной выдачи.
    customFields: {
      [SYSTEM_FIELD_IDS.projectCode]: projectRefs.p4.code,
      [fieldIds.projectInventory]: '0412',
    },
    creatorId: userIds.vinnichek,
    createdAt: isoAgo(90),
    updatedAt: isoAgo(0, 11, 45),
  },
  {
    id: '40000000-0000-4000-8000-000000000005',
    code: null,
    name: 'Тендер на УП «Минскметрострой»',
    description: '«Тема» без шифра: подготовка тендерного предложения.',
    color: 'sky',
    typeId: typeId(2),
    portfolioId: groupId(3),
    clientId: counterpartyIds.minstroy,
    managerId: userIds.klevantovich,
    assistantIds: [],
    visibility: 'open',
    status: 'active',
    startDate: isoDateIn(-20),
    endDate: isoDateIn(30),
    completedAt: null,
    archivedAt: null,
    customFields: {},
    creatorId: userIds.klevantovich,
    createdAt: isoAgo(20),
    updatedAt: isoAgo(3, 15, 10),
  },
  {
    id: '40000000-0000-4000-8000-000000000006',
    code: 'I007',
    name: 'Секретный контракт: реконструкция депо',
    description: 'Проект, в котором текущий демо-сотрудник не участвует.',
    color: 'terra',
    typeId: typeId(1),
    portfolioId: groupId(1),
    clientId: counterpartyIds.minstroy,
    managerId: userIds.shaiderova,
    assistantIds: [],
    visibility: 'secret',
    status: 'active',
    startDate: isoDateIn(-40),
    endDate: isoDateIn(200),
    completedAt: null,
    archivedAt: null,
    customFields: {},
    creatorId: userIds.shaiderova,
    createdAt: isoAgo(40),
    updatedAt: isoAgo(4, 10, 0),
  },
  {
    id: '40000000-0000-4000-8000-000000000007',
    code: '0360',
    name: 'Реконструкция насосной станции',
    description: 'Архивный договор: работы завершены и сданы.',
    color: 'green',
    typeId: typeId(1),
    portfolioId: groupId(1),
    clientId: counterpartyIds.tehssnab,
    managerId: userIds.klimovich,
    assistantIds: [],
    visibility: 'open',
    status: 'archived',
    startDate: isoDateIn(-500),
    endDate: isoDateIn(-200),
    completedAt: isoAgo(200),
    archivedAt: isoAgo(180),
    customFields: {},
    creatorId: userIds.klimovich,
    createdAt: isoAgo(500),
    updatedAt: isoAgo(180),
  },
];

const row = (
  projectId: string,
  userId: string,
  source: ProjectParticipantSource,
  observerKind: ProjectObserverKind | null = null,
  joinedAt = isoAgo(30),
): DemoParticipantRow => ({ projectId, userId, source, observerKind, joinedAt });

export const demoParticipantRows: DemoParticipantRow[] = [
  row(projectRefs.p1.id, userIds.klimovich, 'manager'),
  row(projectRefs.p1.id, userIds.klevantovich, 'assistant'),
  row(projectRefs.p1.id, userIds.akulich, 'task'),
  row(projectRefs.p1.id, userIds.matorin, 'task'),
  row(projectRefs.p1.id, userIds.voronina, 'observer', 'joined', isoAgo(5)),
  row(projectRefs.p2.id, userIds.klimovich, 'manager'),
  row(projectRefs.p2.id, userIds.akulich, 'member'),
  row(projectRefs.p2.id, userIds.polomar, 'observer', 'invited'),
  row(projectRefs.p3.id, userIds.klevantovich, 'manager'),
  row(projectRefs.p3.id, userIds.matorin, 'assistant'),
  row(projectRefs.p3.id, userIds.klimovich, 'task'),
  row(projectRefs.p3.id, userIds.akulich, 'task'),
  row(projectRefs.p4.id, userIds.vinnichek, 'manager'),
  row(projectRefs.p4.id, userIds.klimovich, 'assistant'),
  row(projectRefs.p4.id, userIds.matorin, 'member'),
  row(projectRefs.p4.id, userIds.akulich, 'observer', 'invited'),
  row('40000000-0000-4000-8000-000000000005', userIds.klevantovich, 'manager'),
  row('40000000-0000-4000-8000-000000000006', userIds.shaiderova, 'manager'),
  row('40000000-0000-4000-8000-000000000006', userIds.karpovich, 'member'),
  row('40000000-0000-4000-8000-000000000007', userIds.klimovich, 'manager'),
];

export function findDemoProjectRow(id: string): DemoProjectRow | undefined {
  return demoProjectRows.find((project) => project.id === id);
}

export function demoParticipantRowsOf(projectId: string): DemoParticipantRow[] {
  return demoParticipantRows.filter((entry) => entry.projectId === projectId);
}

export function removeDemoParticipant(
  projectId: string,
  userId: string,
  source?: ProjectParticipantSource,
): void {
  for (let index = demoParticipantRows.length - 1; index >= 0; index -= 1) {
    const entry = demoParticipantRows[index];
    if (!entry || entry.projectId !== projectId || entry.userId !== userId) continue;
    if (source && entry.source !== source) continue;
    demoParticipantRows.splice(index, 1);
  }
}

export function addDemoParticipant(entry: DemoParticipantRow): void {
  const exists = demoParticipantRows.some(
    (row) =>
      row.projectId === entry.projectId &&
      row.userId === entry.userId &&
      row.source === entry.source,
  );
  if (!exists) demoParticipantRows.push(entry);
}
