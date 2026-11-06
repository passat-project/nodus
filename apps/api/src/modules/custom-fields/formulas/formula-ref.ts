import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type { FormulaRecordData } from '../ports/record-values.port.js';
import type { FormulaContextCache, FormulaContextService } from './formula-context.service.js';
import type { FormulaRegistrySnapshot } from './formula-meta.service.js';

/** Цель атрибута-ссылки (#632, Р7 г): только своё дерево и не конфиденциальные;
 *  письмо/контрагент источниками атрибутов V1 не являются (O5). */
export async function resolveRefSource(
  host: FormulaRecordData,
  number: number,
  snapshot: FormulaRegistrySnapshot,
  tx: TransactionClient | undefined,
  cache: FormulaContextCache,
  context: Pick<FormulaContextService, 'record'>,
): Promise<FormulaRecordData | null> {
  const definition = snapshot.byNumber.get(number);
  if (!definition) return null;
  const raw = host.values[definition.id];
  if (raw === undefined || raw === null || Array.isArray(raw) || typeof raw === 'object') {
    return null;
  }
  const targetId = String(raw);
  switch (definition.type) {
    case 'task':
    case 'node':
    case 'project': {
      const target = await context.record(definition.type, targetId, undefined, tx, cache);
      if (!target || target.confidential) return null;
      // Цель обязана быть в проекте хоста (Р7 г) — иначе источник недоступен.
      const hostProject = host.kind === 'project' ? host.id : host.projectId;
      if ((target.projectId ?? null) !== (hostProject ?? null)) return null;
      return target;
    }
    default:
      return null;
  }
}
