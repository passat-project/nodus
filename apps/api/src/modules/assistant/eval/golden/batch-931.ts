import type { GoldenCase } from '../golden-set.types.js';

/** #931: безопасные действия проекта — статус, участие, портфель, папки. */
export const BATCH_931_CASES: readonly GoldenCase[] = [
  {
    id: 'gip-project-status-01',
    role: 'gip',
    form: 'official',
    query: 'Заверши проект «Северный»',
    expectedTools: ['projects.list', 'projects.set_status'],
    forbiddenTools: ['projects.update', 'projects.create'],
    rationale:
      'Найти проект по имени (projects.list), затем projects.set_status; правка полей и создание — другое.',
  },
  {
    id: 'gip-project-status-02',
    role: 'gip',
    form: 'colloquial',
    query: 'Верни проект «Речной» в работу',
    expectedTools: ['projects.list', 'projects.set_status'],
    forbiddenTools: ['projects.update'],
    rationale:
      'Возврат в работу — projects.set_status; переименование и правка полей не просились.',
  },
  {
    id: 'emp-project-join-01',
    role: 'employee',
    form: 'colloquial',
    query: 'Присоединись к проекту «Северный»',
    expectedTools: ['projects.list', 'projects.join'],
    forbiddenTools: ['projects.add_member', 'projects.create'],
    rationale:
      'Сам сотрудник вступает projects.join; приглашение других (add_member) и создание — другое.',
  },
  {
    id: 'emp-project-leave-01',
    role: 'employee',
    form: 'official',
    query: 'Покинь проект «Речной»',
    expectedTools: ['projects.list', 'projects.leave'],
    forbiddenTools: ['projects.join', 'projects.update'],
    rationale: 'Выход из проекта — projects.leave; присоединение и правка проекта не относятся.',
  },
  {
    id: 'adm-project-group-rename-01',
    role: 'admin',
    form: 'official',
    query: 'Переименуй портфель «Жилые» в «Жилые объекты»',
    expectedTools: ['projects.groups', 'projects.update_group'],
    forbiddenTools: ['projects.create_group', 'projects.update'],
    rationale:
      'Найти портфель (projects.groups), затем переименовать (projects.update_group); создание и проекты — другое.',
  },
  {
    id: 'gip-project-node-rename-01',
    role: 'gip',
    form: 'official',
    query: 'Переименуй папку «Раздел 1» в «Рабочая документация»',
    expectedTools: ['projects.structure', 'projects.update_node'],
    forbiddenTools: ['projects.add_node', 'projects.move_node'],
    rationale:
      'Найти папку в структуре (projects.structure), затем projects.update_node; создание и перенос не просили.',
  },
  {
    id: 'gip-project-node-move-01',
    role: 'gip',
    form: 'typo',
    query: 'Перенеси папку «Сметы» в корень проэкта «Северный»',
    expectedTools: ['projects.structure', 'projects.move_node'],
    forbiddenTools: ['projects.add_node', 'projects.update_node'],
    rationale: 'Перенос папки — projects.move_node; создание и переименование — другие операции.',
  },
];
