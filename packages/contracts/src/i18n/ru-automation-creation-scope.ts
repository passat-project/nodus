/** Строки раздела «Где создаётся» (#665): одна связь «тип процесса × тип
 *  проекта», показанная с двух сторон. */
export const creationScopeStrings = {
  sectionTitle: 'Где создаётся',
  projectSectionTitle: 'Типы задач и писем',
  projectSummary: 'Разрешены {allowed} из {total}',
  projectSummaryAll: 'Все разрешены',
  projectSummaryNone: 'Нет живых типов',
  tasksGroup: 'Задачи',
  lettersGroup: 'Письма',
  empty: 'Живых типов нет — создайте тип в «Процессах»',
  withoutProject: 'Без проекта',
  folderKind: 'Тип папки',
  folderKindAny: 'Где угодно',
  projectTypeRow: 'Проекты',
  projectTypesEmpty: 'Типов проектов нет',
  allowAll: 'Разрешить во всех типах проектов',
  /** Связь пишется в настройку типа процесса: право `workflow.manage`. */
  noWorkflowPermission: 'Менять связь может настройщик процессов',
  /** Снятие работы, привязанной к включённому типу папки (#665). */
  unbindWarning:
    'Работа этого типа создаётся только в папке своего типа — без папки её будет не создать',
} as const;
