import type {
  CustomFieldBindings,
  CustomFieldDefinition,
  CustomFieldModule,
  CustomFieldSettings,
  CustomFieldType,
  CustomFieldValues,
} from '@nodus/contracts';
import { SystemDictionary, SYSTEM_FIELD_IDS } from '@nodus/contracts';

import { currencyIds, dictionaryByCode, itemsOf, workKindIds } from './dictionaries.js';
import { MARKA_FIELD_ID } from './set-marks.js';
import { departmentIds } from './org-ids.js';
import { processTypeIds } from './process-type-ids.js';
import { demoProjectTypeIds } from './projects.js';
import { nodeKindIds } from './project-nodes.js';
import { projectRefs, tid } from './task-item-factory.js';
import { fieldIds } from './field-ids.js';
import { userIds } from './users.js';

/** Демо-реестр атрибутов портала (#631): одно определение — много мест.
 *  Посев повторяет миграцию: системные «Шифр»/«Заказчик»/«Код» (детермини-
 *  рованные id), сквозная «Марка» (вид папки + тип задачи), глобальная
 *  переменная, ссылки на записи. Определения живут массивом: мок-хендлеры
 *  создают, правят и удаляют их как сервер. */


const STAMP = '2026-10-20T09:00:00.000Z';

let nextNumber = 1;

function definition(
  id: string,
  type: CustomFieldType,
  name: string,
  bindings: Partial<CustomFieldBindings>,
  extra: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition {
  return {
    id,
    number: nextNumber++,
    type,
    name,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: {
      processTypeIds: bindings.processTypeIds ?? [],
      projectTypeIds: bindings.projectTypeIds ?? [],
      nodeKindIds: bindings.nodeKindIds ?? [],
    },
    sortOrder: 0,
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

/** Привязка к типам (#432, В2): стандарт и переработка — основные
 *  демо-типы задач; «Сайт заказчика» и «Проект-источник» намеренно без
 *  мест — проверка правила «атрибут без привязок нигде не показывается». */
const STD = [processTypeIds.standard];
const STD_OVT = [processTypeIds.standard, processTypeIds.overtime];

/** Все демо-типы проектов и виды папок (посев миграции #631, Р9). */
const ALL_PROJECT_TYPES = [demoProjectTypeIds.contract, demoProjectTypeIds.topic];
const ALL_NODE_KINDS = [nodeKindIds.section, nodeKindIds.komplekt];

/** Определения в порядке реестра (sortOrder назначает файл-фабрика ниже). */
export const demoCustomFieldDefinitions: CustomFieldDefinition[] = [
  definition(
    fieldIds.projectCode,
    'text',
    'Шифр',
    { projectTypeIds: ALL_PROJECT_TYPES },
    {
      hint: 'Шифр договора, например 22-01',
    },
  ),
  definition(fieldIds.projectClient, 'counterparty', 'Заказчик', {
    projectTypeIds: ALL_PROJECT_TYPES,
  }),
  definition(
    fieldIds.nodeCode,
    'text',
    'Код',
    { nodeKindIds: ALL_NODE_KINDS },
    {
      hint: 'Код папки в структуре проекта',
    },
  ),
  definition(
    fieldIds.invoiceNumber,
    'text',
    '№ накладной',
    { processTypeIds: STD },
    {
      hint: 'Номер из накладной поставщика',
    },
  ),
  definition(fieldIds.handoverDate, 'date', 'Дата передачи', { processTypeIds: STD }),
  definition(fieldIds.customer, 'user', 'Сотрудник-заказчик', { processTypeIds: STD }),
  definition(
    fieldIds.contractAmount,
    'money',
    'Сумма договора',
    { processTypeIds: STD },
    {
      settings: moneySettings,
      dictionary: dictionaryRef(SystemDictionary.CURRENCY),
    },
  ),
  definition(
    fieldIds.workKind,
    'enum',
    'Вид работ',
    { processTypeIds: STD },
    {
      settings: { dictionaryId: dictionaryByCode('work-kind')!.id },
      dictionary: dictionaryRef('work-kind'),
      defaultValue: { kind: 'static', value: workKindIds.design },
    },
  ),
  definition(
    fieldIds.objects,
    'multienum',
    'Объекты',
    { processTypeIds: STD },
    {
      settings: { dictionaryId: dictionaryByCode('object')!.id },
      dictionary: dictionaryRef('object'),
    },
  ),
  definition(fieldIds.overtime, 'duration', 'Часы переработки', {
    processTypeIds: STD_OVT,
  }),
  definition(fieldIds.overtimeDate, 'date', 'Дата переработки', {
    processTypeIds: [processTypeIds.overtime],
  }),
  definition(fieldIds.approved, 'bool', 'Согласовано с заказчиком', { processTypeIds: STD }),
  definition(
    fieldIds.projectFolder,
    'link',
    'Папка проекта',
    { processTypeIds: STD },
    {
      hint: 'Путь в общем хранилище',
    },
  ),
  definition(fieldIds.customerSite, 'link', 'Сайт заказчика', {}),
  definition(
    fieldIds.applicantDepartment,
    'department',
    'Подразделение заявителя',
    { processTypeIds: STD },
    { defaultValue: { kind: 'author_department' } },
  ),
  definition(
    fieldIds.area,
    'number',
    'Площадь, м²',
    { processTypeIds: STD },
    {
      settings: { precision: 2 },
    },
  ),
  definition(fieldIds.customerComment, 'long_text', 'Комментарий заказчика', {
    processTypeIds: STD,
  }),
  definition(fieldIds.customerObservers, 'users', 'Наблюдатели заказчика', { processTypeIds: STD }),
  definition(fieldIds.sourceProject, 'project', 'Проект-источник', {}),
  definition(fieldIds.contractor, 'counterparty', 'Подрядчик', { processTypeIds: STD }),
  // Бывший «скрытый»: глобального скрытия нет (О2) — атрибут без привязок,
  // значения живы, процессы читают; «спрятать» = снять привязки.
  definition(
    fieldIds.legacyCode,
    'text',
    'Шифр сметы (служебный)',
    {},
    {
      hint: 'Заполняет автоматика из сметной программы',
    },
  ),
  definition(
    fieldIds.letterObjectCode,
    'text',
    'Шифр объекта',
    { processTypeIds: [processTypeIds.letterIncoming] },
    { hint: 'Шифр проекта или объекта из письма корреспондента' },
  ),
  definition(fieldIds.letterReplyRequired, 'bool', 'Требуется ответ', {
    processTypeIds: [processTypeIds.letterIncoming],
  }),
  definition(fieldIds.letterTask, 'task', 'Задача по письму', {
    processTypeIds: [processTypeIds.letterIncoming],
  }),
  definition(fieldIds.counterpartyErp, 'text', 'Код 1С', {}),
  // Глобальная переменная (Р7): значение одно на компанию, правит админ.
  definition(
    fieldIds.mobilizationDays,
    'number',
    'Срок мобилизации, дней',
    {},
    {
      isCompany: true,
      companyValue: 14,
      hint: 'Глобальная переменная для процессов',
    },
  ),
  // Сквозная «Марка» (критерий приёмки 1): один атрибут — вид папки
  // «Комплект» и тип «Стандартный»; фильтры каждой сущности свои.
  definition(
    fieldIds.marka,
    'enum',
    'Марка',
    { processTypeIds: STD, nodeKindIds: [nodeKindIds.komplekt] },
    {
      hint: 'Марка комплекта по СТБ 2255',
      settings: { dictionaryId: dictionaryByCode('set-mark')!.id },
      dictionary: dictionaryRef('set-mark'),
    },
  ),
];

// Глобальный порядок реестра (sortOrder): по порядку массива.
demoCustomFieldDefinitions.forEach((entry, index) => {
  entry.sortOrder = index;
});

export function demoFieldById(id: string): CustomFieldDefinition | undefined {
  return demoCustomFieldDefinitions.find((entry) => entry.id === id);
}

/** Следующий внутренний номер (мок «сервер»): sequence не откатывается. */
export function nextFieldNumber(): number {
  return nextNumber++;
}

/** Атрибуты модуля «Где используется» (семантика GET ?module=). */
export function demoFieldsOfModule(
  module: CustomFieldModule,
  typeCategories: { taskTypeIds: ReadonlySet<string>; letterTypeIds: ReadonlySet<string> },
): CustomFieldDefinition[] {
  return demoCustomFieldDefinitions
    .filter((entry) => {
      if (module === 'company') return entry.isCompany;
      const { processTypeIds, projectTypeIds, nodeKindIds } = entry.bindings;
      switch (module) {
        case 'task':
          return processTypeIds.some((id) => typeCategories.taskTypeIds.has(id));
        case 'letter':
          return processTypeIds.some((id) => typeCategories.letterTypeIds.has(id));
        case 'project':
          return projectTypeIds.length > 0;
        case 'node':
          return nodeKindIds.length > 0;
      }
    })
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
    [fieldIds.marka]: itemsOf('set-mark')[0]!.id,
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

export { fieldIds } from './field-ids.js';
