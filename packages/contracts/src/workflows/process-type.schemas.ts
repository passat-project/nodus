import { z } from 'zod';

import { creationFormSchema } from './creation-form.js';
import { processTypeConfigSchema, processTypeViewerSchema } from './process-type-config.js';
import { stageColorSchema } from './workflow-primitives.schemas.js';

/**
 * Тип процесса (глобальный справочник, ADR-0020/ADR-0024; библиотека типов и
 * редактор маршрутов — #378, #428). Один тип — один маршрут через схему
 * «тип → маршрут»; нужен другой маршрут — новый тип копией (решение
 * владельца 19.10). Категория — сущность, которую ведёт тип: задача или
 * письмо (карточки разные, движок и редактор общие).
 */

/** Значки типов — закрытый набор ключей lucide (реестр на вебе:
 *  `shared/workflow/task-type-icon.tsx`); новый значок = расширение набора. */
export const processTypeIconSchema = z.enum([
  'square-check',
  'zap',
  'file-text',
  'pencil-ruler',
  'clipboard-check',
  'send',
  'search-check',
  'wrench',
  'calculator',
  'drafting-compass',
  'messages-square',
  'calendar-clock',
  'shield-check',
  'package',
  'flag',
  'star',
]);
export type ProcessTypeIcon = z.infer<typeof processTypeIconSchema>;

/** Категория типа — сущность модуля-владельца (ADR-0024): задача (`tasks`)
 *  или письмо (`correspondence`). Неизменяема после создания: от неё зависят
 *  карточка, реестры и адаптер движка. */
export const processCategorySchema = z.enum(['task', 'letter']);
export type ProcessCategory = z.infer<typeof processCategorySchema>;

/** Направление письма — только у категории `letter` (входящее/исходящее). */
export const letterDirectionSchema = z.enum(['incoming', 'outgoing']);
export type LetterDirection = z.infer<typeof letterDirectionSchema>;

/** Серия номеров типа в DTO (#55): префикс «Вх»/«Исх», сброс по году
 *  часового пояса компании; номер — `${prefix}-${год}/${N}` без ведущих нулей. */
export const processTypeNumberingSchema = z.object({
  seriesId: z.uuid(),
  prefix: z.string().min(1).max(16),
  reset: z.literal('year'),
});
export type ProcessTypeNumbering = z.infer<typeof processTypeNumberingSchema>;

/** Тип процесса (глобальный справочник, I15). `creatable=false` — скрыт:
 *  не предлагается при создании сущностей (новые и настроенные типы). */
export const processTypeSchema = z.object({
  id: z.uuid(),
  /** Служебный код; у типов из редактора генерирует сервер, в UI не показывается. */
  code: z.string().min(1),
  name: z.string().min(1),
  category: processCategorySchema,
  /** Направление письма; null у задач (CHECK БД: только у `letter`). */
  direction: letterDirectionSchema.nullable(),
  icon: processTypeIconSchema,
  color: stageColorSchema,
  /** Описание для сотрудников (подсказка в выборе типа при создании). */
  description: z.string(),
  /** Доступен при создании сущностей. */
  creatable: z.boolean(),
  isSystem: z.boolean(),
  sortOrder: z.number().int().min(0),
  archivedAt: z.iso.datetime().nullable(),
  /** Маршрут типа — холст редактора. */
  workflowId: z.uuid(),
  /** Состав карточки, доступ и пульс — настройки типа (#432, В6). */
  config: processTypeConfigSchema,
  /** Эффективная форма создания опубликованного маршрута (#432): окно
   *  узла «Создание»; у типа без формы — форма по умолчанию категории. */
  creationForm: creationFormSchema,
  /** Что может текущий пользователь (сервер — истина, I8): веб прячет
   *  невидимые типы и недоступное создание. */
  viewer: processTypeViewerSchema,
  /** Нумерация типа (#55, Р2): серия и её префикс (гидрирует сервер из
   *  `config.numbering`); null — тип без нумерации (все задачи). Веб
   *  показывает «Будет присвоен номер Вх-2026/…» и «Нумерацию» настроек. */
  numbering: processTypeNumberingSchema.nullable(),
});
export type ProcessType = z.infer<typeof processTypeSchema>;

export const processTypeRefSchema = processTypeSchema.pick({
  id: true,
  code: true,
  name: true,
  category: true,
  icon: true,
  color: true,
});
export type ProcessTypeRef = z.infer<typeof processTypeRefSchema>;

/** `GET /workflows/types?archived=`: exclude (по умолчанию) — живые; include —
 *  с архивом (свёрнутая группа); only — только архив. */
export const processTypeListQuerySchema = z.object({
  archived: z.enum(['include', 'only']).optional(),
  /** Фильтр категории (задачные хуки просят `task`). */
  category: processCategorySchema.optional(),
});
export type ProcessTypeListQuery = z.infer<typeof processTypeListQuerySchema>;

/** Основа маршрута при создании типа: копия живого типа или простой
 *  Ожидает → В работе → Завершена. */
export const processTypeBaseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('copy'), typeId: z.uuid() }),
  z.object({ kind: z.literal('simple') }),
]);
export type ProcessTypeBase = z.infer<typeof processTypeBaseSchema>;

/** `POST /workflows/types` — тип создаётся скрытым (`creatable=false`).
 *  Категория неизменяема; у письма обязателен `direction`. */
export const createProcessTypeBodySchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    category: processCategorySchema.default('task'),
    direction: letterDirectionSchema.optional(),
    icon: processTypeIconSchema,
    color: stageColorSchema,
    description: z.string().trim().max(500).optional(),
    base: processTypeBaseSchema,
  })
  .refine((v) => (v.category === 'letter') === (v.direction !== undefined), {
    message: 'direction is required for letters and forbidden for tasks',
  });
export type CreateProcessTypeBody = z.infer<typeof createProcessTypeBodySchema>;

/** `PATCH /workflows/types/:id` — свойства типа (сохраняются сразу, публикации
 *  требует только маршрут); системному типу имя менять можно (это данные),
 *  архивировать — нельзя. Категория и направление неизменяемы. */
export const updateProcessTypeBodySchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    icon: processTypeIconSchema.optional(),
    color: stageColorSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    creatable: z.boolean().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });
export type UpdateProcessTypeBody = z.infer<typeof updateProcessTypeBodySchema>;
