import { ErrorCode } from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import type { RegistryFieldChange } from '../custom-fields/ports/custom-field-registry.port.js';
import type { FormulaCells } from '../custom-fields/ports/formula-cells.port.js';

/**
 * Формульная обвязка PATCH папки (#632/#660), вынесена из сервиса структуры
 * ради лимита строк файла (I5): формульная ячейка руками не пишется —
 * значение в атрибут папки со своей формулой или формулой вида — 422.
 */
export async function assertNodeCellsWritable(
  formulaCells: Pick<FormulaCells, 'lockedFieldIds'>,
  tx: TransactionClient,
  nodeId: string,
  changes: readonly RegistryFieldChange[],
): Promise<void> {
  if (changes.length === 0) return;
  const locked = await formulaCells.lockedFieldIds(
    tx,
    'node',
    nodeId,
    changes.map((change) => change.fieldId),
  );
  if (locked.size > 0) {
    throw new DomainException(
      ErrorCode.FORMULA_CELL_LOCKED,
      'Formula cell value is computed by its formula',
      { fields: [...locked] },
      422,
    );
  }
}
