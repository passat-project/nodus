import { ui } from '@nodus/contracts';

import type { FieldDef } from './use-view-fields.js';

/**
 * ЕДИНЫЙ реестр блоков карточки задачи на канбан-доске (стандарт владельца,
 * раунд 3): id — те, что читает общая BoardTaskCard; видимость — шестерёнка
 * ViewSettings того же viewKey. Потребители: «Мой план» (tasks.kanban) и
 * канбан карточки проекта (projects.kanban — там «Проект» по умолчанию
 * скрыт: доска открыта в контексте проекта).
 */
export function makeTaskCardFields({
  projectVisible = true,
}: { projectVisible?: boolean } = {}): FieldDef[] {
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
  ];
}
