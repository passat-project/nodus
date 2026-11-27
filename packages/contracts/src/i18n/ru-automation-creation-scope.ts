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
  withoutProject: 'Можно создавать без проекта',
  folderKind: 'Ограничение по папке',
  folderKindAny: 'Не ограничивать',
  projectTypeRow: 'Проекты',
  projectTypesEmpty: 'Типов проектов нет',
  allowAll: 'Разрешить во всех типах проектов',
  /** Связь пишется в настройку типа процесса: право `workflow.manage`. */
  noWorkflowPermission: 'Менять связь может настройщик процессов',
  /** Снятие типа задачи, привязанного к включённому типу папки (#665). */
  unbindWarning:
    'Задачи этого типа создаются только в папке своего типа — без папки их будет не создать',
} as const;
