import type { CustomFieldDefinition } from '@nodus/contracts';

import { definition } from './custom-field-demo-factory.js';
import { COUNTER_FIELD_NUMBERS, COUNTER_RULES, fieldIds } from './field-ids.js';
import { nodeKindSeedIds } from './node-kind-ids.js';
import { processTypeIds } from './process-type-ids.js';
import { demoProjectTypeIds } from './projects.js';

/**
 * Демо-счётчики (#630, модель v3 — по глоссарию и #557): «Изм.» и «№
 * разрешения» — работе «Изменение» при создании (их пишут в штамп), «№
 * накладной выдачи» `{Инв. № проекта}-{N}` — кнопкой «Выдать в печать»;
 * папке «Комплект» — «№ комплекта» при создании, проекту-договору — «№
 * договора в портфеле». «Выдано номеров» и пример гидрирует мок-стор счетов
 * (numbering-store). Вынесено из `custom-fields.ts` (I5).
 *
 * ФУНКЦИЯ, а не массив: номера явные и резервируются в общей sequence —
 * вызов на своём месте в реестре сохраняет номера остальных атрибутов
 * (импорт-массив зарезервировал бы 32…37 раньше и сдвинул их на 38+).
 */
export function counterDemoFields(): CustomFieldDefinition[] {
  const change = [processTypeIds.change];
  return [
    definition(
      fieldIds.changeNumber,
      'counter',
      'Изм.',
      { processTypeIds: change },
      {
        hint: 'Номер изменения внутри комплекта — пишут в штамп чертежа',
        number: COUNTER_FIELD_NUMBERS.changeNumber,
        numbering: {
          rule: COUNTER_RULES.changeNumber,
          onCreate: change,
          preview: 'Изм. 1',
          issuedCount: 0,
        },
      },
    ),
    definition(
      fieldIds.permitNumber,
      'counter',
      '№ разрешения',
      { processTypeIds: change },
      {
        hint: 'Номер в книге изменений: сквозной, с начала каждого года',
        number: COUNTER_FIELD_NUMBERS.permitNumber,
        numbering: {
          rule: COUNTER_RULES.permitNumber,
          onCreate: change,
          preview: '15-26',
          issuedCount: 0,
        },
      },
    ),
    definition(
      fieldIds.waybillNumber,
      'counter',
      '№ накладной выдачи',
      { processTypeIds: change },
      {
        hint: 'Накладная на передачу в печать: Инв. № проекта и порядковый номер',
        number: COUNTER_FIELD_NUMBERS.waybillNumber,
        numbering: {
          rule: COUNTER_RULES.waybillNumber,
          onCreate: [],
          preview: '…-1',
          issuedCount: 0,
        },
      },
    ),
    definition(
      fieldIds.projectInventory,
      'text',
      'Инв. №',
      {
        projectTypeIds: [
          demoProjectTypeIds.contract,
          demoProjectTypeIds.topic,
          demoProjectTypeIds.procurement,
        ],
      },
      {
        hint: 'Инвентарный номер объекта — входит в номер накладной',
        number: COUNTER_FIELD_NUMBERS.projectInventory,
      },
    ),
    definition(
      fieldIds.komplektSeq,
      'counter',
      '№ комплекта',
      { nodeKindIds: [nodeKindSeedIds.komplekt] },
      {
        hint: 'Номер комплекта внутри папки, где он создан',
        number: COUNTER_FIELD_NUMBERS.komplektSeq,
        numbering: {
          rule: COUNTER_RULES.komplektSeq,
          onCreate: [nodeKindSeedIds.komplekt],
          preview: 'К-01',
          issuedCount: 0,
        },
      },
    ),
    definition(
      fieldIds.projectSeq,
      'counter',
      '№ договора в портфеле',
      { projectTypeIds: [demoProjectTypeIds.contract] },
      {
        hint: 'Номер договора внутри портфеля, с начала каждого года',
        number: COUNTER_FIELD_NUMBERS.projectSeq,
        numbering: {
          rule: COUNTER_RULES.projectSeq,
          onCreate: [demoProjectTypeIds.contract],
          preview: '001/26',
          issuedCount: 0,
        },
      },
    ),
  ];
}
