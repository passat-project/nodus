import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания инструментов справочников (#926). */
export const dictionariesMeta = {
  'dictionaries.list': {
    why: 'Показать перечень бизнес-справочников портала: код, название и иерархичность.',
    whenToUse:
      '«Какие справочники есть в портале», «покажи список справочников», «какие справочники вообще есть» — затем код для dictionaries.items.',
    whenNotToUse:
      'Не для элементов конкретного справочника (dictionaries.items, когда код уже известен).',
    subject: 'справочник',
    effect: 'read',
    example: { input: { limit: 30 }, note: 'перечень справочников портала' },
    returns: 'Справочники: название, код, признак иерархичности.',
    nextStep: 'Возьми код справочника и вызови dictionaries.items.',
    intent: 'list',
  },
  'dictionaries.items': {
    why: 'Показать элементы справочника по коду: варианты значений, сортировку и архивные.',
    whenToUse:
      '«Покажи элементы справочника видов договоров», «какие варианты в справочнике document-types», «какие значения у справочника».',
    whenNotToUse:
      'Не для перечня справочников (dictionaries.list, когда код неизвестен) и не для типов процессов (workflows.process_types).',
    subject: 'элемент',
    effect: 'read',
    example: {
      input: { code: 'document-types', limit: 40 },
      note: 'элементы справочника по коду',
    },
    returns: 'Элементы: название, код, порядок сортировки, признак архива.',
    nextStep: 'Назови вариант так, как он записан в справочнике; код бери из dictionaries.list.',
    intent: 'get',
  },
} satisfies Record<string, ToolStandard>;
