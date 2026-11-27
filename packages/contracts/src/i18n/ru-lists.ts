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
};
