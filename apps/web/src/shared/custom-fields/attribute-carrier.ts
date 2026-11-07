import type { CustomFieldFormulas, CustomFieldRef, CustomFieldValues } from '@nodus/contracts';

/**
 * Атрибуты записи в DTO (#632, Р9): значения по id определения, имена
 * ссылок значений и формульное состояние ячеек. Одна форма у всех носителей
 * (задача, письмо, проект, папка) — по ней работают атрибутные колонки
 * видов, карточки канбана и ячейки структуры.
 *
 * Поля НЕобязательные: задача несёт их в DTO списка и детали давно, письма
 * и проекты получают в DTO списка вместе с расширением контракта (бэкенд,
 * Пакет 2a). Реестры видов поэтому читают их «когда есть»: колонка
 * атрибута существует по определению, а значение появляется, как только
 * сервер начал его отдавать — без правок UI.
 */
export interface AttributeCarrier {
  customFields?: CustomFieldValues;
  customFieldRefs?: readonly CustomFieldRef[];
  customFieldFormulas?: CustomFieldFormulas;
}

/** Строка DTO с атрибутами: пересечение полей сущности и носителя атрибутов. */
export type AttributeRow<T> = T & AttributeCarrier;
