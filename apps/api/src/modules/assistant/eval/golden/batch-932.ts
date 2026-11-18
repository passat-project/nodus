import type { GoldenCase } from '../golden-set.types.js';

/** #932: безопасная админ/сервисная часть — контрагенты, справочники, DND. */
export const BATCH_932_CASES: readonly GoldenCase[] = [
  {
    id: 'gip-cp-list-01',
    role: 'gip',
    form: 'official',
    query: 'Покажи контрагентов, в названии которых есть «Строй»',
    expectedTools: ['counterparties.list'],
    forbiddenTools: ['counterparties.create', 'counterparties.update'],
    rationale: 'Поиск по реестру — counterparties.list; создание и правка реквизитов не просились.',
  },
  {
    id: 'sec-cp-card-01',
    role: 'secretary',
    form: 'colloquial',
    query: 'Открой карточку контрагента «Стройпроект» — какие у них контакты?',
    expectedTools: ['counterparties.list', 'counterparties.get'],
    forbiddenTools: ['counterparties.update'],
    rationale:
      'Сначала найти контрагента по имени (counterparties.list), затем карточка с контактами (counterparties.get); правка реквизитов — другое.',
  },
  {
    id: 'adm-cp-create-01',
    role: 'admin',
    form: 'official',
    query: 'Заведи контрагента «Мостоотряд 5» с УНП 190123456',
    expectedTools: ['counterparties.create'],
    forbiddenTools: ['counterparties.update', 'counterparties.list'],
    rationale:
      'Создание записи справочника — counterparties.create; поиск и правка существующего — другие операции.',
  },
  {
    id: 'adm-cp-update-01',
    role: 'admin',
    form: 'colloquial',
    query: 'Поправь у контрагента «Стройпроект» телефон на новый',
    expectedTools: ['counterparties.list', 'counterparties.update'],
    forbiddenTools: ['counterparties.create'],
    rationale:
      'Найти контрагента (counterparties.list), затем правка реквизитов (counterparties.update); создание не просили.',
  },
  {
    id: 'adm-dict-item-create-01',
    role: 'admin',
    form: 'official',
    query: 'Добавь в справочник «Виды договоров» вариант «Договор субподряда»',
    expectedTools: ['dictionaries.list', 'dictionaries.item_create'],
    forbiddenTools: ['dictionaries.item_update'],
    rationale:
      'Найти код справочника (dictionaries.list), затем новый вариант (dictionaries.item_create); переименование — другое.',
  },
  {
    id: 'adm-dict-item-update-01',
    role: 'admin',
    form: 'typo',
    query: 'Переименуй в справочнике «Причны отказа» вариант «Брак» в «Брак материалов»',
    expectedTools: ['dictionaries.items', 'dictionaries.item_update'],
    forbiddenTools: ['dictionaries.item_create'],
    rationale:
      'Найти вариант в справочнике (dictionaries.items), затем переименовать (dictionaries.item_update); создание — другое.',
  },
  {
    id: 'emp-notif-settings-01',
    role: 'employee',
    form: 'colloquial',
    query: 'Покажи мои настройки уведомлений и часы тишины',
    expectedTools: ['notifications.settings'],
    forbiddenTools: ['notifications.update_settings'],
    rationale: 'Просмотр личных настроек — notifications.settings; правка не просилась.',
  },
  {
    id: 'emp-notif-update-01',
    role: 'employee',
    form: 'official',
    query: 'Включи режим «не беспокоить» с 22:00 до 08:00',
    expectedTools: ['notifications.update_settings'],
    forbiddenTools: ['notifications.settings'],
    rationale:
      'Прямая правка настроек — notifications.update_settings; отдельное чтение настроек не требуется.',
  },
];
