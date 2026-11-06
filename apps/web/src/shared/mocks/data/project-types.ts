import type { ProjectType } from '@nodus/contracts';
import { SYSTEM_FIELD_IDS } from '@nodus/contracts';

import { isoAgo } from './dates.js';
import { nodeKindIds } from './project-nodes.js';

/** Демо-типы проектов мок-мира (#631): слоты форм системных атрибутов
 *  («Шифр», «Заказчик») и доступные виды узлов. Вынесено из projects.ts
 *  ради лимита строк файла (I5); данные прежние. */

export const typeId = (n: number): string =>
  `41000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** id демо-типов проектов (посев #631 привязывает системные атрибуты). */
export const demoProjectTypeIds = {
  contract: typeId(1),
  topic: typeId(2),
  procurement: typeId(3),
} as const;

export const demoProjectTypes: ProjectType[] = [
  {
    id: demoProjectTypeIds.contract,
    name: 'Договор',
    icon: 'file-text',
    color: 'blue',
    // Слоты формы типа (Р10 #631): «Шифр» — бывшая политика codeField
    // required, «Заказчик» — всегда по желанию.
    form: {
      fields: [
        { fieldId: SYSTEM_FIELD_IDS.projectCode, state: 'required' },
        { fieldId: SYSTEM_FIELD_IDS.projectClient, state: 'optional' },
      ],
    },
    // «Договору» доступны все виды справочника (null): новый вид попадёт
    // типу сам — явный список только там, где набор сужен («Тема»).
    kindIds: null,
    archivedAt: null,
  },
  {
    id: demoProjectTypeIds.topic,
    name: 'Тема',
    icon: 'star',
    color: 'amber',
    // У «Темы» шифра нет (бывший codeField hidden): миграция #631 всё равно
    // сеет слот «Шифр» состоянием hidden (реальная БД) — мок повторяет.
    form: {
      fields: [
        { fieldId: SYSTEM_FIELD_IDS.projectCode, state: 'hidden' },
        { fieldId: SYSTEM_FIELD_IDS.projectClient, state: 'optional' },
      ],
    },
    // «Теме» комплекты не нужны — только разделы и этапы (ADR-0030).
    kindIds: [nodeKindIds.section, nodeKindIds.phase],
    archivedAt: null,
  },
  {
    id: demoProjectTypeIds.procurement,
    name: 'Госзакупки',
    icon: 'shield-check',
    color: 'green',
    form: {
      fields: [
        { fieldId: SYSTEM_FIELD_IDS.projectCode, state: 'optional' },
        { fieldId: SYSTEM_FIELD_IDS.projectClient, state: 'optional' },
      ],
    },
    kindIds: null,
    archivedAt: isoAgo(90),
  },
];
