import type { CreationForm, ProcessType, ProcessTypeRef } from '@nodus/contracts';
import { customFieldKey } from '@nodus/contracts';

import { quickProcessType, systemProcessType } from './task-stages.js';
import { fieldIds } from './field-ids.js';
import { processTypeIds } from './process-type-ids.js';
import { demoRoleIds } from './roles.js';
import { letterProcessTypes } from './letter-catalog.js';

/** Типы задач мок-библиотеки «Автоматизации» (ревизия 2, #378; формы и состав
 *  карточки — #432): два системных типа, «Переработка» и «Кадровый запрос»
 *  (демонстраторы настроек типа), «Комплект», «Изменение» и архивный тип;
 *  типы писем (#55) — `letter-catalog.ts`. Маршруты типов — соседний
 *  `workflows.ts`. */

const wid = (n: number): string =>
  `20000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`;
export const STANDARD_WORKFLOW_ID = wid(50);
export const QUICK_WORKFLOW_ID = wid(51);
export const ARCHIVED_WORKFLOW_ID = wid(52);
export const OVERTIME_WORKFLOW_ID = wid(53);
export const HR_WORKFLOW_ID = wid(54);
/** Маршрут типа «Комплект» (#632): быстрый маршрут + форма с формулой. */
export const KOMPLEKT_WORKFLOW_ID = wid(55);
/** Маршрут типа «Изменение» (#630): быстрый + «Выдать в печать». */
export const CHANGE_WORKFLOW_ID = wid(56);

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

/** Тип «Комплект» (#632): демонстратор формул типа — «Шифр комплекта»
 *  считается из данных проекта, папки-здания, марки и номера. */
export const komplektType: DemoProcessType = {
  id: processTypeIds.komplekt,
  code: 'komplekt',
  name: 'Комплект',
  icon: 'package',
  color: 'info',
  description: 'Комплект документации: марка, номер и шифр по формуле',
  creatable: true,
  category: 'task',
  direction: null,
  isSystem: false,
  sortOrder: 4,
  archivedAt: null,
  workflowId: KOMPLEKT_WORKFLOW_ID,
  numbering: null,
  config: { card: { hiddenBlocks: [], roleLabels: {} }, access: allAccess },
};

/** Тип «Изменение» (#630): работа внутри папки «Комплект» — носитель
 *  счётчиков Изм./«Взял изм»/№ разрешения и кнопки «Выдать в печать». */
export const changeType: DemoProcessType = {
  id: processTypeIds.change,
  code: 'change',
  name: 'Изменение',
  icon: 'pencil-ruler',
  color: 'warning',
  description: 'Изменение выпущенного комплекта: Изм. N по папке и номер книги',
  creatable: true,
  category: 'task',
  direction: null,
  isSystem: false,
  sortOrder: 5,
  archivedAt: null,
  workflowId: CHANGE_WORKFLOW_ID,
  numbering: null,
  config: { card: { hiddenBlocks: [], roleLabels: {} }, access: allAccess },
};

export const changeTypeRef: ProcessTypeRef = {
  id: changeType.id,
  code: changeType.code,
  name: changeType.name,
  category: changeType.category,
  icon: changeType.icon,
  color: changeType.color,
};

/** Ссылка типа для демо-задач комплектов (TaskListItem.type). */
export const komplektTypeRef: ProcessTypeRef = {
  id: komplektType.id,
  code: komplektType.code,
  name: komplektType.name,
  category: komplektType.category,
  icon: komplektType.icon,
  color: komplektType.color,
};

/** Форма создания «Комплекта»: марка и номер обязательны, шифр считает
 *  формула (человек может поправить — тогда значение подавляет формулу). */
export const komplektCreationForm: CreationForm = {
  fields: [
    { key: customFieldKey(fieldIds.marka), label: 'Марка', required: true, preset: null },
    {
      key: customFieldKey(fieldIds.komplektNumber),
      label: 'Номер комплекта',
      required: true,
      preset: null,
    },
    {
      key: customFieldKey(fieldIds.komplektCipher),
      label: 'Шифр комплекта',
      required: false,
      preset: null,
    },
    { key: 'project', label: null, required: false, preset: null },
  ],
  chips: [],
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
  sortOrder: 5,
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
  komplektType,
  changeType,
  archivedDemoType,
  ...letterProcessTypes,
];

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
