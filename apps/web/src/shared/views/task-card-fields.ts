import { useMemo } from 'react';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useCustomFieldDefinitions } from '../custom-fields/queries.js';
import { attributeFieldDefs } from './attribute-fields.js';
import type { FieldDef } from './use-view-fields.js';

/**
 * ЕДИНЫЙ реестр блоков карточки задачи на канбан-доске (стандарт владельца,
 * раунд 3): id — те, что читает общая BoardTaskCard; видимость — шестерёнка
 * ViewSettings того же viewKey. Потребители: «Мой план» (tasks.kanban) и
 * канбан карточки проекта (projects.kanban — там «Проект» по умолчанию
 * скрыт: доска открыта в контексте проекта).
 *
 * `definitions` — атрибуты модуля «Задачи» (#632): блоки карточки с
 * `group: 'attributes'` и определением — BoardTaskCard рисует значение
 * через грамматику типа, пустое значение блок не показывает.
 */
export function makeTaskCardFields({
  projectVisible = true,
  definitions,
}: {
  projectVisible?: boolean;
  definitions?: readonly CustomFieldDefinition[];
} = {}): FieldDef[] {
  return [
    { id: 'parent', label: ui.tasks.subtaskOf, defaultVisible: true },
    { id: 'number', label: ui.tasks.fieldNumber, defaultVisible: true },
    { id: 'type', label: ui.tasks.fieldType, defaultVisible: true },
    { id: 'source', label: ui.tasks.fieldSource, defaultVisible: true },
    { id: 'deadline', label: ui.tasks.deadline, defaultVisible: true },
    { id: 'project', label: ui.tasks.project, defaultVisible: projectVisible },
    { id: 'assignee', label: ui.tasks.assignee, defaultVisible: true },
    { id: 'comments', label: ui.tasks.comments, defaultVisible: true },
    { id: 'spent', label: ui.tasks.colSpent, defaultVisible: true },
    ...attributeFieldDefs({ definitions, module: 'task' }),
  ];
}

/** Реестр блоков карточки канбана с атрибутами портала (#632): определения
 *  грузятся один раз на операцию, реестр — мемо-производная. */
export function useTaskCardFields({
  projectVisible = true,
}: { projectVisible?: boolean } = {}): FieldDef[] {
  const { data } = useCustomFieldDefinitions('task');
  return useMemo(
    () => makeTaskCardFields({ projectVisible, definitions: data }),
    [projectVisible, data],
  );
}
