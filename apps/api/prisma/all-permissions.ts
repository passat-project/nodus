/**
 * Права системной роли «Администратор». Дублирует каталог `Permission`
 * контрактов намеренно: seed исполняется до сборки contracts
 * (`prisma db seed` в свежем клоне), поэтому импорт из `@nodus/contracts`
 * здесь не годится. Рассинхрон ловит `src/rbac-permissions.test.ts`.
 *
 * `ADMIN_EXCLUDED_PERMISSIONS` — права каталога, которые «Администратор»
 * НЕ получает по умолчанию (#52, вердикт 29.10): секретные проекты админы
 * не видят — надзор идёт через отдельную роль «Системный надзор»
 * (`project.view_secret`), а публикация в канал проекта — только руководству
 * проекта и точечной выдаче матрицей (`project.channel.post`, Slack
 * announcement-паттерн; миграция 20261105000000 тоже никому не выдаёт).
 */
export const ALL_PERMISSIONS = [
  'core.admin',
  'task.create',
  'task.assign',
  'task.view_all',
  'task.manage_any',
  'task.override_gate',
  // #496: форс-мажор правки закреплённого поля (окна ввода, замок записи).
  'task.edit_locked',
  'workflow.manage',
  'directory.read',
  'directory.manage',
  'user.manage',
  'role.manage',
  'dictionary.manage',
  // #55: права корреспонденции v3; админу — миграцией 20261031120000_correspondence_permissions.
  'correspondence.register',
  'correspondence.resolve',
  // #461: конфиденциальные письма — каталог, никому по умолчанию (В3).
  'correspondence.view_confidential',
  'sticker.manage',
  'chat.moderate',
  'settings.uiDefaults',
  'crm.create',
  'crm.manage',
  // #431: управление атрибутами; роли admin выдаётся миграцией 20261028120000_custom_fields.
  'custom_field.manage',
  // #52: ядро проектов; админу — миграцией 20261105000000_projects_core
  // (кроме view_secret — надзор отдельной ролью).
  'project.create',
  'project.manage',
  'project.setup.manage',
  'project.channel.post',
  'project.view_secret',
] as const;

/** Не входит в дефолт «Администратора»: системный надзор — отдельная роль,
 *  публикация в канал проекта — руководство/точечная выдача, конфиденциальные
 *  письма — «никто, даже админ» (вердикт владельца 04.11, #461 В3). */
export const ADMIN_EXCLUDED_PERMISSIONS = [
  'project.view_secret',
  'project.channel.post',
  'correspondence.view_confidential',
] as const;

/** Что сид выдаёт роли admin: каталог минус исключения надзора. */
export const GRANTED_ADMIN_PERMISSIONS: readonly string[] = ALL_PERMISSIONS.filter(
  (permission) => !(ADMIN_EXCLUDED_PERMISSIONS as readonly string[]).includes(permission),
);
