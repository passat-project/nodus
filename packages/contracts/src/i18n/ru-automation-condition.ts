/** Конструктор общей выборки (#635, unified-model §7): субъекты, предикаты,
 *  кванторы, настройка обхода — строки панели кнопки редактора маршрута.
 *  Вынесено из ru-automation.ts (I5). */
export const conditionStrings = {
  condition: {
    /** «Какие записи» — субъекты выборки; у категории писем задачных нет. */
    subject: 'Какие записи',
    subjects: {
      self: 'Эта запись',
      parent_task: 'Родительская задача',
      subtasks: 'Подзадачи этой задачи',
      relations: 'Связанные задачи',
      folder_tasks: 'Задачи папки этой записи',
      project_tasks: 'Задачи проекта',
      project_folders: 'Папки проекта',
      folder_type_tasks: 'Работы в папках типа',
      project: 'Сам проект',
      ref_field: 'Записи по ссылке из поля',
    },
    subjectFolderType: 'Тип папки',
    subjectFolderTypeAny: 'Любой тип папки',
    subjectRelation: 'Вид связи',
    subjectDirection: 'Направление',
    subjectDirections: {
      out: 'Исходящие',
      in: 'Входящие',
      both: 'В обе стороны',
    },
    subjectField: 'Поле-ссылка',
    subjectNoRefFields: 'У этого типа нет атрибутов-ссылок на записи',
    /** «Условие» — предикаты по записи выборки. */
    where: 'Условие',
    addPredicate: 'Добавить условие по записи',
    predicates: {
      type_is: 'Тип записи',
      field: 'Значение поля',
      stage_is: 'Статус',
      system_state: 'Группа статуса',
      outcome: 'Итог',
      result_issued: 'Результат выдан',
    },
    predicateField: 'Атрибут',
    predicateOp: 'Оператор',
    predicateValue: 'Значение',
    predicateOps: {
      eq: 'равно',
      ne: 'не равно',
      gt: 'больше',
      gte: 'не меньше',
      lt: 'меньше',
      lte: 'не больше',
      contains: 'содержит',
      not_contains: 'не содержит',
      in_any: 'совпадает с одним из',
      filled: 'заполнено',
      not_filled: 'не заполнено',
    },
    stageNeedsType: 'Добавьте тип записи — статус выбирается по типу',
    /** «Сколько» — квантор. */
    quantifier: 'Сколько записей',
    quantifiers: {
      all: 'Все записи',
      any: 'Хотя бы одна запись',
      none: 'Ни одна запись',
    },
    /** Список правил кнопки: две группы. */
    groupConditions: 'Условия',
    groupConditionsHint: 'Кого пускает к кнопке: не выполнено — кнопка не видна',
    groupChecks: 'Проверки',
    groupChecksHint: 'Что должно быть готово: кнопка видна, но не пускает и называет причину',
    addCondition: 'Добавить условие',
    addCheck: 'Добавить проверку',
    addKinds: {
      records: 'По записям',
      formula: 'Формула',
    },
    /** Проверка: подпись причины (обязательна). */
    checkTitle: 'Подпись причины',
    checkTitlePlaceholder: 'Например: Смежники не приняли задания',
    checkTitleHint: 'Эту фразу увидит сотрудник, которому кнопка не даст перейти',
    removeRule: 'Удалить',
    /** Обход — настройка проверки. */
    override: 'Обход',
    overrideDefaultHint:
      'По умолчанию обходят руководство проекта в своём проекте и обладатели права — с обязательной причиной',
    overrideForbidden: 'Запретить обход',
    overrideForbiddenHint: 'Проверку не обойдёт никто — даже обладатели права',
    overrideUsers: 'Дополнительные сотрудники',
    overrideUsersEmpty: 'Выберите сотрудников',
    overrideRole: 'Роль в проекте',
    overrideNoRole: 'Не задана',
    formulaLead: 'Формула должна вернуть истину или ложь',
  },
} as const;
