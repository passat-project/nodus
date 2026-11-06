import type { CustomFieldDefinition, CustomFieldType, FormulaNode } from '@nodus/contracts';

import { FORMULA_DEMO_NUMBERS, fieldIds } from './field-ids.js';
import { nodeKindSeedIds } from './node-kind-ids.js';
import { processTypeIds } from './process-type-ids.js';

/** Демо-атрибуты формул (#632): «Номер комплекта»/«Шифр комплекта» у типа
 *  «Комплект» и «№ по ГП» у вида «Здание по генплану». Номера фиксированы —
 *  их адресует AST формулы типа (`FORMULA_DEMO_NUMBERS`). Вынесены из
 *  `custom-fields.ts` (I5) и не тянут стор узлов: id видов — лист-модуль. */

const STAMP = '2026-10-20T09:00:00.000Z';

function demoField(
  id: string,
  number: number,
  type: CustomFieldType,
  name: string,
  hint: string,
  bindings: { processTypeIds?: string[]; nodeKindIds?: string[] },
  bindingFormulas?: Record<string, FormulaNode>,
): CustomFieldDefinition {
  return {
    id,
    number,
    type,
    name,
    hint,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: {
      processTypeIds: bindings.processTypeIds ?? [],
      projectTypeIds: [],
      nodeKindIds: bindings.nodeKindIds ?? [],
    },
    sortOrder: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...(bindingFormulas ? { bindingFormulas } : {}),
  };
}

/** Формула типа «Комплект»: шифр проекта — № по ГП здания — марка — номер.
 *  Живёт на привязке «Шифр комплекта × Комплект», а не на атрибуте. */
const komplektCipherFormula: FormulaNode = {
  kind: 'op',
  op: 'concat',
  args: [
    {
      kind: 'field',
      source: { kind: 'project' },
      number: FORMULA_DEMO_NUMBERS.projectCode,
      name: 'Шифр',
    },
    { kind: 'literal', value: '-' },
    {
      kind: 'field',
      source: { kind: 'folder_nearest', kindId: nodeKindSeedIds.building },
      number: FORMULA_DEMO_NUMBERS.buildingGp,
      name: '№ по ГП',
    },
    { kind: 'literal', value: '-' },
    { kind: 'field', source: { kind: 'self' }, number: FORMULA_DEMO_NUMBERS.marka, name: 'Марка' },
    {
      kind: 'field',
      source: { kind: 'self' },
      number: FORMULA_DEMO_NUMBERS.komplektNumber,
      name: 'Номер комплекта',
    },
  ],
};

export const formulaDemoFields: CustomFieldDefinition[] = [
  demoField(
    fieldIds.komplektNumber,
    FORMULA_DEMO_NUMBERS.komplektNumber,
    'number',
    'Номер комплекта',
    'Порядковый номер в папке',
    { processTypeIds: [processTypeIds.komplekt] },
  ),
  demoField(
    fieldIds.komplektCipher,
    FORMULA_DEMO_NUMBERS.komplektCipher,
    'text',
    'Шифр комплекта',
    'Считается формулой типа: шифр проекта — № по ГП — марка номер',
    { processTypeIds: [processTypeIds.komplekt] },
    { [processTypeIds.komplekt]: komplektCipherFormula },
  ),
  demoField(
    fieldIds.buildingGp,
    FORMULA_DEMO_NUMBERS.buildingGp,
    'text',
    '№ по ГП',
    'Номер здания по генеральному плану',
    { nodeKindIds: [nodeKindSeedIds.building] },
  ),
];
