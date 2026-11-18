import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания записи справочников (#932): вариант создан/изменён. */
export const dictionariesWriteMeta = {
  'dictionaries.item_create': {
    why: 'Добавить вариант в бизнес-справочник портала (I15): причины, виды, категории.',
    whenToUse:
      '«Добавь вариант в справочник», «новый вид договора», «добавь причину отказа», «заведи категорию».',
    whenNotToUse:
      'Не для переименования варианта (dictionaries.item_update) и не для нового справочника — он создаётся в интерфейсе.',
    subject: 'элемент',
    alsoSubjects: ['справочник'],
    effect: 'irreversible',
    example: {
      input: { dictionaryCode: 'document-kind', item: { name: 'Договор субподряда' } },
      note: 'код справочника берётся из dictionaries.list',
    },
    returns: 'Карточка подтверждения; после выполнения — новый вариант справочника.',
    nextStep: 'Покажи элементы справочника, чтобы сотрудник увидел порядок.',
    intent: 'create',
  },
  'dictionaries.item_update': {
    why: 'Переименовать вариант справочника или сменить его цвет.',
    whenToUse:
      '«Переименуй вариант в справочнике», «поправь название категории», «покрась вариант в …».',
    whenNotToUse:
      'Не для нового варианта (dictionaries.item_create) и не для вариантов другого справочника.',
    subject: 'элемент',
    alsoSubjects: ['справочник'],
    effect: 'irreversible',
    example: {
      input: {
        dictionaryCode: 'document-kind',
        itemId: '5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a',
        patch: { name: 'Договор подряда' },
      },
      note: 'patch — updateDictionaryItemBodySchema; color=null убирает цвет',
    },
    returns: 'Карточка подтверждения; после выполнения — вариант с новыми значениями.',
    nextStep: 'Покажи элементы справочника для сверки.',
    intent: 'update',
  },
} satisfies Record<string, ToolStandard>;
