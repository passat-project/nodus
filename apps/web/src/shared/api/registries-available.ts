import { useAuthStore } from '../auth-store.js';
import { isDomainMocked } from './api-mock-config.js';

/**
 * Модуль реестров (#496, Р12): вкладка «Реестры» появляется только когда
 * сервер объявил модуль `registries` в `/auth/me.modules` (#636). В мок-мире
 * показываем демо-реестр «Выдачи заданий» — живой сервер модуль не объявляет,
 * мёртвой плашки в проде нет.
 */
export function registriesAvailable(): boolean {
  if (isDomainMocked('tasks')) return true;
  const modules = useAuthStore.getState().user?.modules;
  return modules?.includes('registries') ?? false;
}
