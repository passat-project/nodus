import { definitionHandlers } from './custom-fields-definition-handlers.js';
import { registryHandlers } from './custom-fields-registry-handlers.js';
import { formulaHandlers } from '../formula/formula-handlers.js';
import { numberingHandlers } from './numbering-handlers.js';

/** Мок-сервер реестра атрибутов портала (#631): правила те же, что у
 *  бэкенда — имя уникально на портале (409 с suggestion существующего),
 *  потолок 1000, белый список смены типа, справочник неизменен, «Проект»
 *  доступен только в мок-мире проектов, привязки идемпотентны и всегда
 *  разрешены, удаление всегда разрешено (значения и формы чистятся).
 *  Глобальная переменная: одно значение, привязки запрещены.
 *
 *  Хендлеры разделены ради лимита строк файла (I5): коллекция и порядок —
 *  `custom-fields-registry-handlers.ts`, один атрибут (привязки,
 *  глобальное значение, правка, usage, удаление) —
 *  `custom-fields-definition-handlers.ts`, общие утилиты —
 *  `custom-fields-mock-utils.ts`, формулы ячеек (#632) —
 *  `../formula/formula-handlers.ts`. Порядок конкатенации сохраняет порядок
 *  оригинального массива: буквальные пути (`/order`, `/bindings/...`,
 *  `/formulas/...`) раньше `:id`-маршрутов (gotcha msw-query). */
export const customFieldsHandlers = [
  ...numberingHandlers,
  ...formulaHandlers,
  ...registryHandlers,
  ...definitionHandlers,
];
