import type {
  CustomFieldDefinition,
  CustomFieldScope,
  CustomFieldSettings,
  CustomFieldType,
  CustomFieldValues,
} from '@nodus/contracts';
import { SystemDictionary } from '@nodus/contracts';

import { currencyIds, dictionaryByCode, itemsOf, workKindIds } from './dictionaries.js';
import { MARKA_FIELD_ID } from './set-marks.js';
import { departmentIds } from './org-ids.js';
import { processTypeIds } from './process-type-ids.js';
import { projectRefs, tid } from './task-item-factory.js';
import { userIds } from './users.js';

/** Демо-реестр кастомных полей (#431) — по полю каждого типа для задач,
 *  поля писем и контрагентов; один скрытый (служебный). Определения живут
 *  массивом: мок-хендлеры создают, правят и удаляют их как сервер. */

const fid = (n: number): string => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const fieldIds = {
  invoiceNumber: fid(1),
  handoverDate: fid(2),
  customer: fid(3),
  contractAmount: fid(4),
  workKind: fid(5),
  objects: fid(6),
  overtime: fid(7),
  approved: fid(8),
  projectFolder: fid(9),
  customerSite: fid(10),
  applicantDepartment: fid(11),
  area: fid(12),
  customerComment: fid(13),
  customerObservers: fid(14),
  sourceProject: fid(15),
  contractor: fid(16),
  legacyCode: fid(17),
  /** Атрибут типа «Переработка» (#432): дата — обязательная в форме. */
  overtimeDate: fid(18),
  /** Атрибуты «Входящего письма» (#55): шифр объекта и отметка «нужен ответ». */
  letterObjectCode: fid(21),
  letterReplyRequired: fid(22),
  counterpartyErp: fid(31),
  /** Атрибут области «Папка» (#556): марка комплекта — посев миграции Б. */
  marka: MARKA_FIELD_ID,
};

const STAMP = '2026-10-20T09:00:00.000Z';

function definition(
  id: string,
  scope: CustomFieldScope,
  type: CustomFieldType,
  name: string,
  sortOrder: number,
  extra: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition {
  return {
    id,
    scope,
    type,
    name,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    hidden: false,
    typeIds: [],
    sortOrder,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  };
}

function dictionaryRef(code: string) {
  const dictionary = dictionaryByCode(code);
  return dictionary
    ? {
        id: dictionary.id,
        code: dictionary.code,
        name: dictionary.name,
        isSystem: dictionary.isSystem,
      }
    : null;
}

const moneySettings: CustomFieldSettings = { currencyId: currencyIds.byn };

/** Привязка атрибута к типам (#432, В2): стандарт и переработка — основные
 *  демо-типы задач; «Сайт заказчика» и «Проект-источник» намеренно без
 *  типов — проверка правила «атрибут без типов нигде не показывается». */
const STD = [processTypeIds.standard];
const STD_OVT = [processTypeIds.standard, processTypeIds.overtime];

/** Определения в порядке реестра (области: task, letter, project, counterparty). */
export const demoCustomFieldDefinitions: CustomFieldDefinition[] = [
  definition(fieldIds.invoiceNumber, 'task', 'text', '№ накладной', 0, {
    hint: 'Номер из накладной поставщика',
    typeIds: STD,
  }),
  definition(fieldIds.handoverDate, 'task', 'date', 'Дата передачи', 1, { typeIds: STD }),
  definition(fieldIds.customer, 'task', 'user', 'Сотрудник-заказчик', 2, { typeIds: STD }),
  definition(fieldIds.contractAmount, 'task', 'money', 'Сумма договора', 3, {
    settings: moneySettings,
    dictionary: dictionaryRef(SystemDictionary.CURRENCY),
    typeIds: STD,
  }),
  definition(fieldIds.workKind, 'task', 'enum', 'Вид работ', 4, {
    settings: { dictionaryId: dictionaryByCode('work-kind')!.id },
    dictionary: dictionaryRef('work-kind'),
    defaultValue: { kind: 'static', value: workKindIds.design },
    typeIds: STD,
  }),
  definition(fieldIds.objects, 'task', 'multienum', 'Объекты', 5, {
    settings: { dictionaryId: dictionaryByCode('object')!.id },
    dictionary: dictionaryRef('object'),
    typeIds: STD,
  }),
  definition(fieldIds.overtime, 'task', 'duration', 'Часы переработки', 6, {
    typeIds: STD_OVT,
  }),
  definition(fieldIds.overtimeDate, 'task', 'date', 'Дата переработки', 7, {
    typeIds: [processTypeIds.overtime],
  }),
  definition(fieldIds.approved, 'task', 'bool', 'Согласовано с заказчиком', 8, { typeIds: STD }),
  definition(fieldIds.projectFolder, 'task', 'link', 'Папка проекта', 9, {
    hint: 'Путь в общем хранилище',
    typeIds: STD,
  }),
  definition(fieldIds.customerSite, 'task', 'link', 'Сайт заказчика', 10),
  definition(fieldIds.applicantDepartment, 'task', 'department', 'Подразделение заявителя', 11, {
    defaultValue: { kind: 'author_department' },
    typeIds: STD,
  }),
  definition(fieldIds.area, 'task', 'number', 'Площадь, м²', 12, {
    settings: { precision: 2 },
    typeIds: STD,
  }),
  definition(fieldIds.customerComment, 'task', 'long_text', 'Комментарий заказчика', 13, {
    typeIds: STD,
  }),
  definition(fieldIds.customerObservers, 'task', 'users', 'Наблюдатели заказчика', 14, {
    typeIds: STD,
  }),
  definition(fieldIds.sourceProject, 'task', 'project', 'Проект-источник', 15),
  definition(fieldIds.contractor, 'task', 'counterparty', 'Подрядчик', 16, { typeIds: STD }),
  definition(fieldIds.legacyCode, 'task', 'text', 'Шифр сметы (служебный)', 17, {
    hint: 'Заполняет автоматика из сметной программы',
    hidden: true,
    typeIds: STD,
  }),
  definition(fieldIds.letterObjectCode, 'letter', 'text', 'Шифр объекта', 0, {
    hint: 'Шифр проекта или объекта из письма корреспондента',
    typeIds: [processTypeIds.letterIncoming],
  }),
  definition(fieldIds.letterReplyRequired, 'letter', 'bool', 'Требуется ответ', 1, {
    typeIds: [processTypeIds.letterIncoming],
  }),
  definition(fieldIds.counterpartyErp, 'counterparty', 'text', 'Код 1С', 0),
  // Область «Папка» (#556): марка комплекта из справочника марок СТБ 2255.
  // Привязка к виду — форма вида (node_kinds.config.form), typeIds пуст.
  definition(fieldIds.marka, 'node', 'enum', 'Марка', 0, {
    hint: 'Марка комплекта по СТБ 2255',
    settings: { dictionaryId: dictionaryByCode('set-mark')!.id },
    dictionary: dictionaryRef('set-mark'),
  }),
];

export function demoFieldById(id: string): CustomFieldDefinition | undefined {
  return demoCustomFieldDefinitions.find((entry) => entry.id === id);
}

export function demoFieldsOfScope(scope: CustomFieldScope): CustomFieldDefinition[] {
  return demoCustomFieldDefinitions
    .filter((entry) => entry.scope === scope)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/** Значения демо-задач: часть задач заполнена, остальные — `{}`. */
export const demoTaskCustomFields: Record<string, CustomFieldValues> = {
  [tid(2)]: {
    [fieldIds.invoiceNumber]: '№ 118-2026',
    [fieldIds.handoverDate]: '2026-10-20',
    [fieldIds.customer]: userIds.klevantovich,
    [fieldIds.contractAmount]: { amount: 128500.5, currencyId: currencyIds.byn },
    [fieldIds.workKind]: workKindIds.design,
    [fieldIds.objects]: [itemsOf('object')[0]!.id, itemsOf('object')[1]!.id],
    [fieldIds.overtime]: 240,
    [fieldIds.approved]: true,
    [fieldIds.projectFolder]: '\\\\srv\\proekt\\0359\\КЖ',
    [fieldIds.customerSite]: 'https://galurgiya.by',
    [fieldIds.applicantDepartment]: departmentIds.bim,
    [fieldIds.area]: 1240.75,
    [fieldIds.customerComment]: 'Согласовано при условии замены узлов КЖ-14 и КЖ-18.',
    [fieldIds.customerObservers]: [userIds.karpovich, userIds.matorin],
    [fieldIds.sourceProject]: projectRefs.p4.id,
    [fieldIds.contractor]: 'd0000000-0000-4000-8000-000000000001',
    [fieldIds.legacyCode]: 'СМ-0359-14',
  },
  [tid(5)]: {
    [fieldIds.invoiceNumber]: '№ 77',
    [fieldIds.handoverDate]: '2026-10-12',
    [fieldIds.workKind]: workKindIds.approval,
    [fieldIds.overtime]: 45,
    [fieldIds.area]: 86.5,
  },
  [tid(12)]: {
    [fieldIds.invoiceNumber]: '№ 121',
    [fieldIds.objects]: [itemsOf('object')[2]!.id],
    [fieldIds.approved]: true,
  },
};

/** Подразделение автора — снимок для умолчания (Р5): текущий пользователь
 *  демо-мира сидит в BIM-отделе. */
export function demoAuthorDepartment(): string {
  return departmentIds.bim;
}
