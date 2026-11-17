import { useAuthStore } from '../auth-store.js';
import { isDomainMocked } from './api-mock-config.js';

/**
 * Доступен ли ИИ-агент (#889): флаг модуля `assistant` пришёл в `/auth/me`
 * (I10), в мок-режиме домен объявлен на моках. Потребители: вход в окно
 * ассистента (кнопка агента, Ctrl+J, кромка мессенджера) и вкладка
 * «Настройки портала → ИИ-агент». Право `assistant.use` проверяется отдельно
 * (без него окно не открывается, даже если флаг включён).
 */
export function assistantAvailable(): boolean {
  if (isDomainMocked('assistant')) return true;
  const modules = useAuthStore.getState().user?.modules;
  return modules?.includes('assistant') ?? false;
}
