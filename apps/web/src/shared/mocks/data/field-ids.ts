/** Стабильные id демо-атрибутов (#631): чистые константы без зависимостей —
 *  общий знаменатель мок-данных (workflows-documents, tasks, custom-fields),
 *  вынесен из custom-fields.ts, чтобы разорвать цикл импортов
 *  (custom-fields → task-item-factory → … → workflows → workflows-documents
 *  → custom-fields). Зависимости — только такие же чистые константы. */
import { SYSTEM_FIELD_IDS, type NumberSeriesRule } from '@nodus/contracts';

import { MARKA_FIELD_ID } from './set-marks.js';
import { nodeKindSeedIds } from './node-kind-ids.js';

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
  /** Ссылка на задачу в атрибутах письма (#631, Р5). */
  letterTask: fid(23),
  counterpartyErp: fid(31),
  /** Глобальная переменная (#631, Р7): срок мобализации для будущих формул. */
  mobilizationDays: fid(41),
  /** Сквозная «Марка» (#631): вид папки «Комплект» + тип «Стандартный». */
  marka: MARKA_FIELD_ID,
  /** Системные поля, посеянные как атрибуты (#631, Р9). */
  projectCode: SYSTEM_FIELD_IDS.projectCode,
  projectClient: SYSTEM_FIELD_IDS.projectClient,
  nodeCode: SYSTEM_FIELD_IDS.nodeCode,
  /** Демо-комплект (#632): номер и шифр комплекта — тип процесса «Комплект». */
  komplektNumber: fid(28),
  komplektCipher: fid(29),
  /** «№ по ГП» — вид папки «Здание по генплану» (формула шифра комплекта). */
  buildingGp: fid(30),
  /** Счётчики (#630): «Изм.» — свой счёт в каждой папке «Комплект» (Кейс A),
   *  «Взял изм» — общий счёт компании, продолжение из Excel (Кейс C), «№
   *  разрешения» — книга «NN-ГГ», заново каждый год (Кейс D). Выдаёт кнопка
   *  «Выдать в печать» типа «Изменение». */
  changeNumber: fid(32),
  tookChangeNumber: fid(33),
  permitNumber: fid(34),
};

/** Внутренние номера счётчиков (#630): явные, как у демо-формул —
 *  sequence их не резервирует сам (формулы обходят фабрику). */
export const COUNTER_FIELD_NUMBERS = {
  changeNumber: 32,
  tookChangeNumber: 33,
  permitNumber: 34,
} as const;

/** Правила счётчиков демо-мира (#630): адресуются id атрибута-цели. */
export const COUNTER_RULES: Record<
  'changeNumber' | 'tookChangeNumber' | 'permitNumber',
  NumberSeriesRule
> = {
  changeNumber: {
    issueOnCreate: false,
    container: { kind: 'folder', nodeKindId: nodeKindSeedIds.komplekt },
    period: 'none',
    template: [{ kind: 'literal', text: 'Изм. ' }, { kind: 'counter' }],
    startValue: 1,
  },
  tookChangeNumber: {
    issueOnCreate: false,
    container: { kind: 'company' },
    period: 'none',
    template: [{ kind: 'counter' }],
    startValue: 1,
  },
  permitNumber: {
    issueOnCreate: false,
    container: { kind: 'company' },
    period: 'year',
    template: [{ kind: 'counter' }, { kind: 'literal', text: '-' }, { kind: 'year', digits: 2 }],
    startValue: 1,
  },
};

/** Внутренние номера атрибутов, на которые ссылаются демо-формулы (#632):
 *  AST в данных собирается по номерам (Р2 — стабильный адрес), поэтому
 *  номера живут рядом с id, а не магическими числами в маршрутах. */
export const FORMULA_DEMO_NUMBERS = {
  /** «Шифр» проекта (первое определение реестра). */
  projectCode: 1,
  /** «Марка» — сквозной атрибут. */
  marka: 27,
  komplektNumber: 28,
  komplektCipher: 29,
  buildingGp: 30,
} as const;
