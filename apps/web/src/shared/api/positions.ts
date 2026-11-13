import { useQuery } from '@tanstack/react-query';
import type { OrgUnitKind, Position } from '@nodus/contracts';

import { api } from '../api-client.js';

/**
 * Справочник должностей (#441) — общий хук уровня shared: его используют
 * справочник и карточка сотрудника (#806: редактор маршрутов больше не
 * использует должности — источник решающего удалён). Фича-модули друг друга
 * не импортируют (I6), поэтому ключ и запрос живут здесь, а `directory-api`
 * реэкспортирует хук для своих компонентов.
 */
export const positionsKeys = {
  all: ['directory', 'positions'] as const,
  kind: (kind: OrgUnitKind) => [...positionsKeys.all, kind] as const,
};

/** Должности одного вида (management/legal), включая архивные при запросе. */
export function usePositions(kind: OrgUnitKind) {
  return useQuery({
    queryKey: positionsKeys.kind(kind),
    queryFn: () => api<Position[]>(`/directory/positions?kind=${kind}`),
  });
}
