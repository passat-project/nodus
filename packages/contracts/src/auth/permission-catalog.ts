import { z } from 'zod';

import { accessStrings } from '../i18n/ru-access.js';
import { Permission } from './permission.js';

/**
 * Каталог прав с привязкой к разделу портала (#379, ADR-0034).
 *
 * Вкладка «Права доступа» модуля — срез каталога по разделу: строки матрицы
 * задаёт порядок `PERMISSION_CATALOG`, столбцы — роли портала. Право
 * принадлежит разделу, в интерфейсе которого оно открывает действие; если
 * такого раздела нет — модулю-владельцу данных (отсюда `dictionary.manage`
 * → «Автоматизация»: варианты атрибутов-списков правятся только там).
 * Перенос права в другой раздел — одна строка, данные не мигрируют.
 *
 * `module` — НЕ id модуля рейки: «Письма» — `correspondence` (на рейке
 * `letters`), «Сотрудники» — `directory` (на рейке `employees`),
 * `settings` — команда «Настройки», `core` — администрирование портала.
 */

/** Раздел портала, на вкладке которого настраивается право. Список только расширяется. */
export const accessModuleSchema = z.enum([
  'automation',
  'tasks',
  'correspondence',
  'projects',
  'crm',
  'chat',
  'directory',
  'settings',
  'core',
]);

export type AccessModule = z.infer<typeof accessModuleSchema>;

export interface PermissionCatalogEntry {
  readonly permission: Permission;
  readonly module: AccessModule;
  readonly label: string;
  readonly description: string;
  /** Заголовок группы строк на вкладке («Процессы», «Атрибуты», …). */
  readonly group: string;
}

/**
 * Привязка прав к разделам — единственный источник состава вкладок.
 * `satisfies Record<Permission, AccessModule>`: новое право без раздела
 * ломает typecheck (второй слой полноты — `permission-catalog.test.ts`).
 * Порядок ключей = порядок строк на вкладке.
 */
const PERMISSION_MODULE = {
  'workflow.manage': 'automation',
  'custom_field.manage': 'automation',
  'dictionary.manage': 'automation',
  'project.setup.manage': 'automation',
  'task.create': 'tasks',
  'task.assign': 'tasks',
  'task.view_all': 'tasks',
  'task.manage_any': 'tasks',
  'task.override_gate': 'tasks',
  'task.edit_locked': 'tasks',
  'correspondence.register': 'correspondence',
  'correspondence.resolve': 'correspondence',
  'correspondence.view_confidential': 'correspondence',
  'project.create': 'projects',
  'project.manage': 'projects',
  'project.channel.post': 'projects',
  'project.view_secret': 'projects',
  'crm.create': 'crm',
  'crm.manage': 'crm',
  'chat.moderate': 'chat',
  'sticker.manage': 'chat',
  'directory.read': 'directory',
  'directory.manage': 'directory',
  'user.manage': 'directory',
  'role.manage': 'directory',
  'settings.uiDefaults': 'settings',
  'core.admin': 'core',
} as const satisfies Record<Permission, AccessModule>;

/** Каталог прав: право, раздел, название и описание (тексты — i18n, I15). */
export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = (
  Object.keys(PERMISSION_MODULE) as Permission[]
).map((permission) => ({
  permission,
  module: PERMISSION_MODULE[permission],
  ...accessStrings.permissions[permission],
}));

/** Права раздела в порядке каталога — строки вкладки «Права доступа». */
export function permissionsOfModule(module: AccessModule): PermissionCatalogEntry[] {
  return PERMISSION_CATALOG.filter((entry) => entry.module === module);
}
