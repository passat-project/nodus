import { Permission } from '@nodus/contracts';

import { isDomainMocked } from '../../../shared/api/api-mock-config.js';
import { useAuthStore } from '../../../shared/auth-store.js';

/**
 * Доступен ли вход в ИИ-агент (#889, I8+I10): флаг модуля `assistant` из
 * `/auth/me` и право `assistant.use`. В мок-режиме домен объявлен на моках —
 * вход показываем (демо работает без бэкенда). Сервер проверяет то же самое
 * на маршрутах — гейт UI не заменяет guard, а не показывает заведомо
 * недоступное.
 */
export function useAssistantEnabled(): boolean {
  const modules = useAuthStore((state) => state.user?.modules);
  const permissions = useAuthStore((state) => state.user?.permissions);
  const flagOn = isDomainMocked('assistant') || Boolean(modules?.includes('assistant'));
  const canUse = Boolean(permissions?.includes(Permission.ASSISTANT_USE));
  return flagOn && canUse;
}
