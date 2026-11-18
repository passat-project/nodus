import { useQuery } from '@tanstack/react-query';
import type { PresenceEntry, PresenceStatus } from '@nodus/contracts';

import { api } from '../../../shared/api-client.js';
import { isDomainMocked } from '../../../shared/api/api-mock-config.js';
import { useIsOnline } from '../../../shared/socket/presence-store.js';
import { directoryKeys } from './directory-keys.js';

/** REST presence — только мок-режим (живого эндпоинта в api нет: presence
 *  эфемерный и живёт в WS-gateway, #104). */
export function usePresence() {
  return useQuery({
    queryKey: directoryKeys.presence(),
    queryFn: () => api<PresenceEntry[]>('/directory/presence'),
    enabled: isDomainMocked('directory'),
  });
}

/** Статус сотрудника для чипа: мок — REST-моки, живой режим — WS presence
 *  (gateway, #104; онлайн = есть живые соединения). */
export function useEmployeePresence(userId: string): PresenceStatus {
  const { data: presence } = usePresence();
  const wsOnline = useIsOnline(userId);
  if (isDomainMocked('directory')) {
    return presence?.find((p) => p.user.id === userId)?.status ?? 'offline';
  }
  return wsOnline ? 'online' : 'offline';
}
