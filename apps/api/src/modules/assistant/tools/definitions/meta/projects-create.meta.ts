import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания инструментов создания проекта (#927). */
export const projectsCreateMeta = {
  'projects.types': {
    why: 'Показать типы проектов с id, чтобы выбрать typeId для создания проекта.',
    whenToUse:
      'Спрашивают «какие типы проектов есть», «тип Договор или Тема», нужен typeId перед projects.create.',
    whenNotToUse: 'Не для создания или правки типа проекта — это админская операция схем проектов.',
    subject: 'справочник',
    effect: 'read',
    example: { input: {}, note: 'живые типы; архивные — includeArchived: true' },
    returns: 'Список типов: название, id, дата архивации.',
    nextStep: 'Возьми id нужного типа и передай в projects.create или projects.add_node.',
    intent: 'list',
  },
  'projects.groups': {
    why: 'Показать портфели журнала проектов с id для выбора portfolioId.',
    whenToUse:
      'Спрашивают «какие портфели есть», «в какой портфель положить проект», нужен portfolioId.',
    whenNotToUse:
      'Не для создания портфеля (projects.create_group) и не для списка проектов (projects.list).',
    subject: 'портфель',
    effect: 'read',
    example: { input: {}, note: 'плоский список портфелей' },
    returns: 'Список портфелей: название и id.',
    nextStep: 'Возьми id портфеля для projects.create или projects.update.',
    intent: 'list',
  },
  'projects.node_kinds': {
    why: 'Показать виды папок структуры проекта с id для kindId.',
    whenToUse: 'Спрашивают «какие виды папок есть», нужен kindId перед projects.add_node.',
    whenNotToUse:
      'Не для самой структуры проекта (projects.structure) и не для создания вида папки (админ).',
    subject: 'папка',
    effect: 'read',
    example: { input: {}, note: 'виды папок: раздел, комплект, работа' },
    returns: 'Список видов: название, id, архивность.',
    nextStep: 'Передай id вида в projects.add_node или projects.update_node.',
    intent: 'list',
  },
  'projects.create': {
    why: 'Создать проект-договор или тему с типом, портфелем, заказчиком и руководителем.',
    whenToUse:
      '«Создай проект «Северный»», «заведи договор №123 типа Договор», «новая тема по объекту» — просьба создать проект.',
    whenNotToUse:
      'Не для правки существующего проекта (projects.update) и не для папки внутри проекта (projects.add_node).',
    subject: 'проект',
    effect: 'irreversible',
    example: {
      input: { name: 'Северный', code: '2026-123', typeId: '6b1e2a3c-4d5f-4a6b-8c7d-9e0f1a2b3c4d' },
      note: 'название и тип обязательны; тип берётся из projects.types',
    },
    returns:
      'Карточка подтверждения; после выполнения — название, id и ссылка на карточку проекта.',
    nextStep:
      'Покажи карточку сотруднику; после выполнения открой проект или добавь папку структуры.',
    intent: 'create',
  },
  'projects.create_group': {
    why: 'Создать портфель (группу журнала), чтобы разложить проекты по объектам.',
    whenToUse: '«Создай портфель «Жилые объекты»», «заведи группу проектов для заказчика».',
    whenNotToUse:
      'Не для создания проекта (projects.create) и не для переноса проекта в портфель (projects.update).',
    subject: 'портфель',
    effect: 'irreversible',
    example: { input: { name: 'Жилые объекты' }, note: 'название до 120 знаков' },
    returns: 'Карточка подтверждения; после выполнения — название и id портфеля.',
    nextStep: 'Создай проект с этим portfolioId или перенеси существующий.',
    intent: 'create',
  },
} satisfies Record<string, ToolStandard>;
