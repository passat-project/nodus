import { Permission, type TransitionForm } from '@nodus/contracts';

import { commentWindow } from './catalog-forms.js';
import { LETTER_CATALOG_REVISION } from './catalog-revisions.js';
import type { CatalogProcessType, CatalogStage, CatalogWorkflow } from './system-catalog.js';

/**
 * Каталог писем (#55, Р5): заготовки маршрутов входящего и исходящего.
 * Коды стадий и кнопок стабильны — на них ссылаются #463 (резолюция) и #464
 * (исходящие). Ревизия каталога писем своя (1): правка писем в #463/#464 не
 * поднимает версии маршрутов задач, а ревизия задач не перезасевает письма.
 *
 * Маршрут намеренно минимален (O5): регистрация — условие-право
 * `correspondence.register`, без ролей-держателей (O2 — таблица держателей
 * появится в #463 вместе с первой кнопкой ожидания).
 */

/** Коды серий нумерации писем (создаёт каталог, `NumberSeries`); правило
 *  серии — «общий разрез, каждый год, префикс-ГГГГ/N» (#630, посев и
 *  backfill миграции идентичны). */
export const LETTER_SERIES = {
  incoming: { code: 'letter-incoming', prefix: 'Вх', name: 'Входящие письма' },
  outgoing: { code: 'letter-outgoing', prefix: 'Исх', name: 'Исходящие письма' },
} as const;

const registerPermission = {
  kind: 'permission',
  permission: Permission.CORRESPONDENCE_REGISTER,
} as const;

/** Окно регистрации: ввод реквизитов; номер выдаёт пост-действие. */
const REGISTRATION_WINDOW: TransitionForm = {
  enabled: true,
  sections: [{ kind: 'registration' }],
};

const NEW: CatalogStage = {
  code: 'new',
  name: 'Новое',
  color: 'neutral',
  systemState: 'backlog',
  isInitial: true,
};

const ON_RESOLUTION: CatalogStage = {
  code: 'on_resolution',
  name: 'На резолюции',
  color: 'info',
  systemState: 'active',
};

const NOT_REGISTERED: CatalogStage = {
  code: 'not_registered',
  name: 'Не зарегистрировано',
  color: 'neutral',
  systemState: 'closed',
  outcome: 'cancelled',
};

const REGISTERED_BY_MISTAKE: CatalogStage = {
  code: 'registered_by_mistake',
  name: 'Ошибочно зарегистрировано',
  color: 'danger',
  systemState: 'closed',
  outcome: 'cancelled',
};

const INCOMING_WORKFLOW: CatalogWorkflow = {
  code: 'letter.incoming',
  name: 'Входящее письмо',
  kind: 'letter',
  revision: LETTER_CATALOG_REVISION,
  stages: [NEW, ON_RESOLUTION, NOT_REGISTERED, REGISTERED_BY_MISTAKE],
  transitions: [
    {
      code: 'register',
      name: 'Зарегистрировать',
      from: 'new',
      to: 'on_resolution',
      display: 'primary',
      rules: { conditions: [registerPermission] },
      form: REGISTRATION_WINDOW,
      // Номер выдаёт движок в той же транзакции (Р1/O8).
      postFunctions: [{ kind: 'assign_number' }],
    },
    {
      code: 'close_unregistered',
      name: 'Закрыть без регистрации',
      from: 'new',
      to: 'not_registered',
      display: 'button',
      intent: 'service',
      rules: { conditions: [registerPermission] },
      form: commentWindow('Причина', true),
    },
    {
      code: 'cancel_registration',
      name: 'Отменить регистрацию',
      from: 'on_resolution',
      to: 'registered_by_mistake',
      display: 'menu',
      intent: 'service',
      rules: { conditions: [registerPermission] },
      form: commentWindow('Причина', true),
    },
  ],
};

const DRAFT: CatalogStage = {
  code: 'draft',
  name: 'Черновик',
  color: 'neutral',
  systemState: 'backlog',
  isInitial: true,
};

const CANCELLED: CatalogStage = {
  code: 'cancelled',
  name: 'Отменено',
  color: 'danger',
  systemState: 'closed',
  outcome: 'cancelled',
};

const OUTGOING_WORKFLOW: CatalogWorkflow = {
  code: 'letter.outgoing',
  name: 'Исходящее письмо',
  kind: 'letter',
  revision: LETTER_CATALOG_REVISION,
  stages: [DRAFT, CANCELLED],
  transitions: [
    {
      code: 'cancel',
      name: 'Отменить',
      from: null,
      to: 'cancelled',
      display: 'menu',
      intent: 'service',
      rules: { conditions: [{ kind: 'role_in', roles: ['author'] }] },
      form: commentWindow('Причина отмены', true),
    },
  ],
};

const INCOMING_TYPE: CatalogProcessType = {
  code: 'letter-incoming',
  name: 'Входящее письмо',
  category: 'letter',
  direction: 'incoming',
  icon: 'file-text',
  color: 'info',
  description: 'Входящая корреспонденция: регистрация и резолюция',
  sortOrder: 10,
  numbering: LETTER_SERIES.incoming,
};

const OUTGOING_TYPE: CatalogProcessType = {
  code: 'letter-outgoing',
  name: 'Исходящее письмо',
  category: 'letter',
  direction: 'outgoing',
  icon: 'send',
  color: 'success',
  description: 'Исходящая корреспонденция: подготовка и отправка',
  sortOrder: 11,
  numbering: LETTER_SERIES.outgoing,
};

/** Типы и маршруты писем для системного каталога. */
export const LETTER_CATALOG_PROCESS_TYPES: readonly {
  type: CatalogProcessType;
  workflow: CatalogWorkflow;
}[] = [
  { type: INCOMING_TYPE, workflow: INCOMING_WORKFLOW },
  { type: OUTGOING_TYPE, workflow: OUTGOING_WORKFLOW },
];
