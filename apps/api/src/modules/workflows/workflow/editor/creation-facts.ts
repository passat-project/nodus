import type { CreationForm, CustomFieldDefinition } from '@nodus/contracts';

import type { TransactionClient } from '../../../../core/database/transaction-runner.js';
import type { UserProfileReader } from '../../../../core/ports/user-profile.port.js';
import type { CustomFieldRegistry } from '../../../custom-fields/ports/custom-field-registry.port.js';

/**
 * Факты формы создания для проверки публикации (#432, Р4): пресеты
 * «ответственный/соисполнители/наблюдатели» обязаны ссылаться на ЖИВЫХ
 * сотрудников — иначе форма опубликуется с мёртвым значением и каждое
 * создание по типу будет падать 422. Проверка идёт при публикации, а не при
 * открытии окна: цена — один запрос на публикацию, не на создание задачи.
 */
export async function creationFactsOf(
  registry: CustomFieldRegistry,
  profiles: UserProfileReader,
  creation: CreationForm | null | undefined,
  tx: TransactionClient,
): Promise<{
  definitions: readonly Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>[];
  activeUserIds?: ReadonlySet<string>;
}> {
  const definitions = await registry.definitions({}, tx);
  const userIds = presetUserIdsOf(creation);
  if (userIds.length === 0) return { definitions };
  const active = await profiles.filterActiveUserIds(userIds, tx);
  return { definitions, activeUserIds: new Set(active) };
}

/** id сотрудников из пресетов формы (без повторов). */
export function presetUserIdsOf(creation: CreationForm | null | undefined): string[] {
  if (!creation) return [];
  const ids: string[] = [];
  for (const slot of creation.fields) {
    if (slot.preset === null) continue;
    if (slot.key === 'assignee' && typeof slot.preset === 'string') ids.push(slot.preset);
    if ((slot.key === 'coexecutors' || slot.key === 'observers') && Array.isArray(slot.preset)) {
      ids.push(...slot.preset);
    }
  }
  return [...new Set(ids)];
}
