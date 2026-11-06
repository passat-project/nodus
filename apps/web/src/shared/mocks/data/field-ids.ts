/** Стабильные id демо-атрибутов (#631): чистые константы без зависимостей —
 *  общий знаменатель мок-данных (workflows-documents, tasks, custom-fields),
 *  вынесен из custom-fields.ts, чтобы разорвать цикл импортов
 *  (custom-fields → task-item-factory → … → workflows → workflows-documents
 *  → custom-fields). Зависимости — только такие же чистые константы. */
import { SYSTEM_FIELD_IDS } from '@nodus/contracts';

import { MARKA_FIELD_ID } from './set-marks.js';

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
};
