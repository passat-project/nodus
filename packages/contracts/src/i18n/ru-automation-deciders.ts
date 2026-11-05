/**
 * Строки решающих (#433) — отдельным модулем: ru-automation.ts держим под
 * лимитом I5. Подключаются спредом в `automationStrings`.
 */
export const deciderStrings = {
  deciders: {
    sectionTitle: 'Кто жмёт',
    rolesOnlyDeciders: 'Только решающие',
    summaryEmpty: 'Не задано — как «Кто видит»',
    hint: 'Человек увидит задачу и кнопку, даже если он не участник. Несколько источников — «любой из».',
    addSource: 'Добавить источник',
    removeSource: 'Убрать источник',
    sources: {
      position: 'Должность',
      manager_of: 'Руководитель',
      employees: 'Сотрудники',
      field: 'Поле «Сотрудник(и)»',
      project_role: 'Роль в проекте',
    },
    positionKind: {
      management: 'Управленческая',
      legal: 'Юридическая',
    },
    positionEmpty: 'Выберите должность',
    managerOf: {
      creator: 'Руководитель автора',
      assignee: 'Руководитель исполнителя',
    },
    employeesEmpty: 'Выберите сотрудников',
    fieldEmpty: 'Выберите поле',
    fieldNotUser: 'Поле не типа «Сотрудник(и)» — решающего по нему не определить',
    projectRole: {
      manager: 'Руководитель проекта',
      assistant: 'Помощник руководителя',
      participant: 'Участник проекта',
      observer: 'Наблюдатель проекта',
    },
  },
} as const;

/** Тексты проблем публикации по источникам решающих (#433). */
export const deciderProblemStrings = {
  decider_not_in_category: 'Решающие настраиваются только для задач',
  decider_field_not_user: 'Источник «поле» должен быть полем «Сотрудник» или «Сотрудники»',
  decider_position_missing: 'Должность решающего удалена, заархивирована или другого вида',
  decider_position_empty:
    'На должности нет сотрудников — кнопку сможет нажать только администратор с причиной',
  decider_window_needs_rights:
    'Кнопка только для решающих требует прав участника (поля, время или итог) — решающий получит отказ',
  decider_source_empty: 'Источник «Сотрудники» пуст — выберите хотя бы одного',
} as const;
