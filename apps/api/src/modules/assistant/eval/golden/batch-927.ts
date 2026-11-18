import type { GoldenCase } from '../golden-set.types.js';

/** #927: создание проекта и справочники типа/портфеля/видов папок. */
export const BATCH_927_CASES: readonly GoldenCase[] = [
  {
    id: 'gip-project-create-01',
    role: 'gip',
    form: 'official',
    query: 'Заведи проект «Речной» типа Договор в портфеле «Жилые объекты»',
    expectedTools: ['projects.types', 'projects.groups', 'projects.create'],
    forbiddenTools: ['projects.add_node', 'projects.update'],
    rationale:
      'Для создания нужны id типа и портфеля (projects.types, projects.groups), затем projects.create; папка и правка — другие операции.',
  },
  {
    id: 'gip-project-types-01',
    role: 'gip',
    form: 'colloquial',
    query: 'Какие типы проектов у нас есть?',
    expectedTools: ['projects.types'],
    forbiddenTools: ['projects.create', 'projects.list'],
    rationale: 'Справочник типов — projects.types; список проектов и создание не просили.',
  },
  {
    id: 'gip-project-groups-01',
    role: 'gip',
    form: 'official',
    query: 'Покажи портфели, по которым разложены проекты',
    expectedTools: ['projects.groups'],
    forbiddenTools: ['projects.list', 'projects.create_group'],
    rationale: 'Портфели журнала — projects.groups; проекты и создание портфеля не запрашивались.',
  },
  {
    id: 'gip-node-kinds-01',
    role: 'gip',
    form: 'typo',
    query: 'Какие виды папок можно создть в проекте?',
    expectedTools: ['projects.node_kinds'],
    forbiddenTools: ['projects.add_node', 'projects.structure'],
    rationale:
      'Справочник видов папок — projects.node_kinds; структура проекта и создание папки — другие инструменты.',
  },
  {
    id: 'adm-project-group-create-01',
    role: 'admin',
    form: 'official',
    query: 'Создай портфель «Жилые объекты»',
    expectedTools: ['projects.create_group'],
    forbiddenTools: ['projects.create', 'projects.update'],
    rationale:
      'Новый портфель — projects.create_group; создание проекта и правка полей не относятся.',
  },
];
