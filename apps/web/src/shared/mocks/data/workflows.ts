import type { CreationForm, ProcessType, WorkflowDetail } from '@nodus/contracts';

import { quickDocument, simpleDocument, standardDocument } from './workflows-documents.js';
import { letterProcessTypes, letterWorkflowDetails } from './letter-catalog.js';

import { quickProcessType, systemProcessType } from './task-stages.js';
import { fieldIds } from './field-ids.js';
import { processTypeIds } from './process-type-ids.js';
import { demoRoleIds } from './roles.js';

/** Библиотека типов задач и их маршрутов (ревизия 2, #378; формы и состав
 *  карточки — #432) — мок-данные «Автоматизации»: два системных типа,
 *  «Переработка» и «Кадровый запрос» (демонстраторы настроек типа) и
 *  архивный демо-тип; типы писем (#55) — `letter-catalog.ts`. Документы —
 *  зеркало каталога API revision 2 (system-catalog.ts). */

export { quickDocument, standardDocument } from './workflows-documents.js';

const wid = (n: number): string =>
  `20000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`;
export const STANDARD_WORKFLOW_ID = wid(50);
export const QUICK_WORKFLOW_ID = wid(51);
export const ARCHIVED_WORKFLOW_ID = wid(52);
export const OVERTIME_WORKFLOW_ID = wid(53);
export const HR_WORKFLOW_ID = wid(54);

/** Тип мок-библиотеки: `viewer` и `creationForm` считает хендлер — они
 *  зависят от актёра и опубликованного документа (Р6, Р2). */
export type DemoProcessType = Omit<ProcessType, 'viewer' | 'creationForm'>;

const allAccess = { view: null, create: null };

export const standardProcessType: DemoProcessType = {
  id: systemProcessType.id,
  code: 'task',
  name: 'Стандартный',
  icon: 'square-check',
  color: 'neutral',
  description: 'С утверждением постановщиком',
  creatable: true,
  category: 'task',
  direction: null,
  isSystem: true,
  sortOrder: 0,
  archivedAt: null,
  workflowId: STANDARD_WORKFLOW_ID,
  numbering: null,
  // «Стандартный» — тип быстрых входов: доступ всем, карточка полная.
  config: { card: { hiddenBlocks: [], roleLabels: {} }, access: allAccess },
};

export const quickTypeDto: DemoProcessType = {
  id: quickProcessType.id,
  code: 'quick',
  name: 'Быстрый',
  icon: 'zap',
  color: 'success',
  description: 'Без утверждения — для мелких поручений',
  creatable: true,
  category: 'task',
  direction: null,
  isSystem: true,
  sortOrder: 1,
  archivedAt: null,
  workflowId: QUICK_WORKFLOW_ID,
  numbering: null,
  config: { card: { hiddenBlocks: [], roleLabels: {} }, access: allAccess },
};

/** Демонстратор модели владельца (критерии приёмки #432): свои атрибуты,
 *  обязательные поля, «Причина» вместо «Описания», скрытые блоки карточки. */
export const overtimeType: DemoProcessType = {
  id: processTypeIds.overtime,
  code: 'overtime',
  name: 'Переработка',
  icon: 'calendar-clock',
  color: 'warning',
  description: 'Заявка на оплату переработки: дата, часы и причина',
  creatable: true,
  category: 'task',
  direction: null,
  isSystem: false,
  sortOrder: 2,
  archivedAt: null,
  workflowId: OVERTIME_WORKFLOW_ID,
  numbering: null,
  config: {
    card: {
      hiddenBlocks: ['checklist', 'subtasks', 'time'],
      roleLabels: { creator: 'Заявитель' },
    },
    access: allAccess,
  },
};

/** Тип «только для руководства»: видят и создают сотрудники с ролью
 *  «Руководитель» (критерий приёмки 3). */
export const hrType: DemoProcessType = {
  id: processTypeIds.hr,
  code: 'hr-request',
  name: 'Кадровый запрос',
  icon: 'clipboard-check',
  color: 'info',
  description: 'Запрос в кадры: видят и создают руководители',
  creatable: true,
  category: 'task',
  direction: null,
  isSystem: false,
  sortOrder: 3,
  archivedAt: null,
  workflowId: HR_WORKFLOW_ID,
  numbering: null,
  config: {
    card: { hiddenBlocks: [], roleLabels: {} },
    access: { view: [demoRoleIds.head], create: [demoRoleIds.head] },
  },
};

export const archivedDemoType: DemoProcessType = {
  id: processTypeIds.archived,
  code: 'custom-check-docs',
  name: 'Проверка документации',
  icon: 'clipboard-check',
  color: 'warning',
  description: 'Старый маршрут проверки',
  creatable: false,
  category: 'task',
  direction: null,
  isSystem: false,
  sortOrder: 4,
  archivedAt: '2026-10-01T10:00:00Z',
  workflowId: ARCHIVED_WORKFLOW_ID,
  numbering: null,
  config: { card: { hiddenBlocks: [], roleLabels: {} }, access: allAccess },
};

export const demoProcessTypes: DemoProcessType[] = [
  standardProcessType,
  quickTypeDto,
  overtimeType,
  hrType,
  archivedDemoType,
  ...letterProcessTypes,
];

const publishedAt = '2026-10-18T14:05:00Z';
const publishedBy = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Климович А.',
  avatarUrl: null,
};

/** Форма создания «Переработки» (критерии приёмки 1–2): дата и часы —
 *  обязательные атрибуты типа, «Проект» — системное поле, описание с
 *  подписью «Причина»; чипов нет. */
export const overtimeCreationForm: CreationForm = {
  fields: [
    { key: `cf.${fieldIds.overtimeDate}`, label: 'Дата переработки', required: true, preset: null },
    { key: `cf.${fieldIds.overtime}`, label: 'Часы переработки', required: true, preset: null },
    { key: 'project', label: null, required: false, preset: null },
    { key: 'description', label: 'Причина', required: true, preset: null },
  ],
  chips: [],
};

export const demoWorkflowDetails: Record<string, WorkflowDetail> = {
  [STANDARD_WORKFLOW_ID]: {
    id: STANDARD_WORKFLOW_ID,
    typeIds: [standardProcessType.id],
    version: 3,
    publishedAt,
    publishedBy,
    document: standardDocument,
    stageEntityCounts: {},
  },
  [QUICK_WORKFLOW_ID]: {
    id: QUICK_WORKFLOW_ID,
    typeIds: [quickTypeDto.id],
    version: 2,
    publishedAt,
    publishedBy,
    document: quickDocument,
    stageEntityCounts: {},
  },
  [OVERTIME_WORKFLOW_ID]: {
    id: OVERTIME_WORKFLOW_ID,
    typeIds: [overtimeType.id],
    version: 1,
    publishedAt,
    publishedBy,
    document: { ...quickDocument, creation: overtimeCreationForm },
    stageEntityCounts: {},
  },
  [HR_WORKFLOW_ID]: {
    id: HR_WORKFLOW_ID,
    typeIds: [hrType.id],
    version: 1,
    publishedAt,
    publishedBy,
    document: quickDocument,
    stageEntityCounts: {},
  },
  [ARCHIVED_WORKFLOW_ID]: {
    id: ARCHIVED_WORKFLOW_ID,
    typeIds: [archivedDemoType.id],
    version: 1,
    publishedAt,
    publishedBy: null,
    document: simpleDocument,
    stageEntityCounts: {},
  },
  ...letterWorkflowDetails,
};
