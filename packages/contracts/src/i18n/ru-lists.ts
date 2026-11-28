import type { ListEntity, ListSystemField, ListViewLevel } from '../lists/list-view.schemas.js';

/**
 * Строки списков с расширением (#435): заголовки колонок системных полей
 * (CSV-выгрузка и панель фильтра) и названия уровней сохранённых настроек.
 * Терминология — русская деловая (ux-principles.md); один словарь на все
 * сущности списков (задачи/письма/папки), расхождения — в PER_ENTITY.
 */

const BASE: Record<ListSystemField, string> = {
  number: 'Номер',
  title: 'Название',
  stage: 'Статус',
  deadline: 'Срок',
  createdAt: 'Создано',
  assignee: 'Ответственный',
  type: 'Тип',
  project: 'Проект',
  folder: 'Папка',
  decidedBy: 'Кто решил',
  decidedAt: 'Когда решили',
  regNumber: 'Регистрационный номер',
  correspondent: 'Корреспондент',
  sentAt: 'Дата документа',
  name: 'Название',
  kind: 'Вид папки',
};

/** Переопределения по сущности (одно слово «Ответственный» у письма —
 *  адресат; у папки kind уже в базе). */
const PER_ENTITY: Partial<Record<ListEntity, Partial<Record<ListSystemField, string>>>> = {
  letter: {
    assignee: 'Адресат',
    stage: 'Статус маршрута',
  },
};

/** Заголовок колонки системного поля для сущности списка. */
export function listSystemFieldLabel(entity: ListEntity, field: ListSystemField): string {
  return PER_ENTITY[entity]?.[field] ?? BASE[field];
}

/** Название уровня сохранённой настройки (общий словарь UI и CSV-пометок). */
export const LIST_VIEW_LEVEL_LABELS: Record<ListViewLevel, string> = {
  personal: 'Личная вкладка',
  project: 'Общая проектная вкладка',
  type_default: 'Список типа по умолчанию',
};

export const listsStrings = {
  listViewLevelLabels: LIST_VIEW_LEVEL_LABELS,
  /** Ячейки логических атрибутов в CSV-выгрузке. */
  boolLabels: { true: 'да', false: 'нет' } as Record<'true' | 'false', string>,
  /** Заголовок колонки удалённого атрибута (список не ломается, #435). */
  removedFieldLabel: 'Удалённый атрибут',
  /** Имена сущностей списков (имя файла выгрузки, подписи). */
  listEntityLabels: { task: 'Задачи', letter: 'Письма', folder: 'Папки' } as Record<
    ListEntity,
    string
  >,
  /** Панель фильтра с расширением (#435): группировка, итоги, вид, CSV. */
  panel: {
    groupBy: 'Группировка',
    groupNone: 'Без группировки',
    groupWithoutValue: 'Без значения',
    totals: 'Итоги',
    addTotal: 'Добавить итог',
    totalCount: 'Количество',
    sum: 'Сумма',
    min: 'Минимум',
    max: 'Максимум',
    totalValue: 'Значение',
    exportCsv: 'Выгрузить CSV',
    saveView: 'Сохранить как вид',
    viewNamePlaceholder: 'Название вида…',
    savedViews: 'Сохранённые виды',
    deleteView: 'Удалить вид',
    viewDeleted: 'Вид удалён',
    viewSaved: 'Вид сохранён',
    saveViewError: 'Не удалось сохранить вид',
    rowsCount: 'записей',
    totalsRow: 'Итог',
    sortHint: 'Сортировка по колонке — на сервере',
  },
  /** Вкладки-списки карточки проекта (#435): создание из «+». */
  tabs: {
    addList: 'Новый список',
    addListTitle: 'Новая вкладка-список',
    whatToShow: 'Что показывать',
    entityTask: 'Задачи этого проекта',
    entityLetter: 'Письма проекта',
    entityFolder: 'Папки проекта',
    tabName: 'Название вкладки',
    tabNamePlaceholder: 'Например, Переработки',
    access: 'Кому доступна вкладка',
    accessPersonal: 'Личная — только мне',
    accessProject: 'Общая — всему проекту',
    saveTab: 'Сохранить вкладкой',
    saveTabError: 'Не удалось сохранить вкладку',
    listTab: 'Список',
    deleteTab: 'Удалить вкладку-список',
    configure: 'Условия, колонки, группировка и итоги вкладки можно менять в её панели фильтра',
  },
  /** Выгрузка CSV (#435): статусы фоновой очереди в тостах. */
  export: {
    preparing: 'Готовим выгрузку CSV…',
    ready: 'Файл CSV готов',
    failed: 'Выгрузка не удалась',
    downloadHint: 'Файл скачается автоматически',
  },
};
