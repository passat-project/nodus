import type { InjectionToken } from '@nestjs/common';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FormulaRecordData } from '../../custom-fields/ports/record-values.port.js';

/**
 * Read-порт проектов и папок как источников формул (#632, Р6/Р11).
 * Реализация живёт в projects (владелец таблиц, I3); custom-fields собирает
 * резолвер движка. Секретные проекты недоступны через формулы по
 * построению: источники не выходят за проект хоста (Р7).
 */
export const PROJECT_FORMULA_VALUES: InjectionToken = 'PROJECT_FORMULA_VALUES';

export interface ProjectFormulaValues {
  /** Карточка проекта-источника. */
  project(projectId: string, tx?: TransactionClient): Promise<FormulaRecordData | null>;

  /** Папка-источник (включая вид папки в placeId). */
  node(nodeId: string, tx?: TransactionClient): Promise<FormulaRecordData | null>;

  /** Срез папок проекта: цепочки предков и агрегаты по цепочке (Р6). */
  projectNodes(projectId: string, tx?: TransactionClient): Promise<FormulaRecordData[]>;
}
