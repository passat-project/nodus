import { z } from 'zod';

/** Виды карточек, у которых есть личные области вкладок (#744). */
export const cardKindSchema = z.enum(['project', 'task', 'letter']);
export type CardKind = z.infer<typeof cardKindSchema>;

/** Предел размера `cardTabs` в JSON: настройка — не хранилище контента. */
export const CARD_TABS_MAX_BYTES = 32 * 1024;
/** Предел числа вкладок в одной карточке (страховка от мусора). */
export const CARD_TABS_MAX_TABS = 64;
/** Длина стабильного id вкладки; файловые id не хранятся — только `files`. */
const tabIdSchema = z.string().min(1).max(80);

/**
 * Группа (область) вкладок в личных настройках. Порядок `groups` — слева
 * направо; id вкладок стабильные: `structure|tasks|about|channel|members|
 * history|body|chat|files` и будущие системные. Файловые вкладки хранятся
 * ОДНИМ плейсхолдером `files`, без `file:<uuid>` — иначе чужое вложение
 * приехало бы в другую задачу/письмо (#745).
 */
export const cardTabGroupPrefSchema = z.object({
  tabs: z.array(tabIdSchema).min(1).max(CARD_TABS_MAX_TABS),
  /** Последняя активная вкладка; нет/неизвестна — первая видимая. */
  active: tabIdSchema.optional(),
});

/**
 * Личная раскладка карточки одного вида (#744, #745): 1–2 области, ширины
 * панели данных и областей, скрытые вкладки, открытая панель беседы.
 * `version` — для будущих миграций; неизвестная версия читается как дефолт.
 * Derived-состояния (временно свёрнутая область/скрытая панель из-за
 * нехватки ширины) сюда НЕ пишутся — только предпочтения пользователя.
 */
export const cardTabsPrefSchema = z
  .object({
    version: z.literal(1),
    /** 1 или 2 группы; больше — третья область в v1 не создаётся. */
    groups: z.array(cardTabGroupPrefSchema).min(1).max(2),
    /** Ширины: панель данных и области; null/нет — системный дефолт. */
    widths: z
      .object({
        data: z.number().int().min(0).max(10_000).optional(),
        groups: z.array(z.number().int().min(0).max(10_000)).max(2).optional(),
      })
      .optional(),
    /** Скрытые вкладки (`files` скрывать нельзя — проверяет движок). */
    hidden: z.array(tabIdSchema).max(CARD_TABS_MAX_TABS).optional(),
    /** Панель беседы открыта пользователем (рендер может временно скрыть). */
    panelOpen: z.boolean().optional(),
  })
  .superRefine((pref, ctx) => {
    const seen = new Set<string>();
    // Файловые id — сессионные: в prefs только плейсхолдер `files`. Иначе
    // чужое вложение могло бы приехать в карточку другого сотрудника.
    for (const [groupIndex, group] of pref.groups.entries()) {
      for (const tab of group.tabs) {
        if (tab.startsWith('file:')) {
          ctx.addIssue({
            code: 'custom',
            path: ['groups', groupIndex, 'tabs'],
            message: 'Файловые вкладки хранятся только плейсхолдером files',
          });
        }
        if (seen.has(tab)) {
          ctx.addIssue({
            code: 'custom',
            path: ['groups', groupIndex, 'tabs'],
            message: `Вкладка ${tab} встречается больше одного раза`,
          });
        }
        seen.add(tab);
      }
      if (group.active?.startsWith('file:')) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', groupIndex, 'active'],
          message: 'Активная вкладка не может быть файловым id',
        });
      }
      if (group.active !== undefined && !group.tabs.includes(group.active)) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', groupIndex, 'active'],
          message: 'Активная вкладка должна входить в свою область',
        });
      }
    }
    if ((pref.hidden ?? []).some((tab) => tab.startsWith('file:'))) {
      ctx.addIssue({ code: 'custom', path: ['hidden'], message: 'Скрыть файловую вкладку нельзя' });
    }
    if (new Set(pref.hidden ?? []).size !== (pref.hidden ?? []).length) {
      ctx.addIssue({ code: 'custom', path: ['hidden'], message: 'Скрытые вкладки повторяются' });
    }
    if (pref.widths?.groups && pref.widths.groups.length > pref.groups.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['widths', 'groups'],
        message: 'Ширин областей больше, чем областей',
      });
    }
  });

/** Личные раскладки по видам карточек (неизвестные виды отбрасываются).
 *  Битая раскладка ОДНОГО вида не роняет остальные: `.catch(undefined)`
 *  отдаёт дефолт только этому виду (портал и соседние настройки живы).
 *  Это схема ЧТЕНИЯ (localStorage/GET): мусор в базе не должен ломать UI. */
export const cardTabsPreferencesSchema = z.object({
  project: cardTabsPrefSchema.optional().catch(undefined),
  task: cardTabsPrefSchema.optional().catch(undefined),
  letter: cardTabsPrefSchema.optional().catch(undefined),
});

/** Строгая схема ЗАПИСИ (PUT /me/preferences): невалидная раскладка —
 *  ошибка 400, а не тихая потеря настроек. Форма та же, что у чтения. */
export const strictCardTabsPreferencesSchema = z.object({
  project: cardTabsPrefSchema.optional(),
  task: cardTabsPrefSchema.optional(),
  letter: cardTabsPrefSchema.optional(),
});

/**
 * Персонализация навигации (концепт «Персональный порядок», issue #4) —
 * ОДИН DTO для двух скоупов, разрешение на клиенте: личное ?? общее ??
 * системный дефолт реестра (новые id из кода дописываются в конец в
 * системном порядке, неизвестные отбрасываются — слияние без миграций):
 * — ЛИЧНЫЕ настройки сотрудника: GET/PUT /api/v1/me/preferences (#745;
 *   localStorage — мгновенный кэш того же DTO, I13);
 * — ОБЩИЕ компании (админ, «Применить порядок для всех»): будущий
 *   GET/PUT /api/v1/settings/ui под Permission.SETTINGS_UI_DEFAULTS.
 * Порядок — ПОЛНЫЙ массив id модулей из nav-реестра клиента; скрытые
 * модули (сепаратор «Скрытое» в рейке) — отдельным списком id.
 * Верхние вкладки модулей кастомизации НЕ подлежат (вердикт владельца
 * 15.09.2026: «с верхних вкладок убрать всё»).
 */
export const uiPreferencesSchema = z.object({
  /** Порядок модулей левой рейки. */
  navOrder: z.array(z.string().min(1)).optional(),
  /** Скрытые модули рейки (живут под «Показать всё ▾» сепаратором). */
  navHidden: z.array(z.string().min(1)).optional(),
  /** Личные области вкладок карточек проекта/задачи/письма (#744). */
  cardTabs: cardTabsPreferencesSchema.optional().catch(undefined),
});

/** Строгая форма для записи: та же `UiPreferences`, но без `.catch` у
 *  `cardTabs` — сервер отклоняет мусор (контракт = истина). */
export const strictUiPreferencesSchema = uiPreferencesSchema.extend({
  cardTabs: strictCardTabsPreferencesSchema.optional(),
});

export type CardTabGroupPref = z.infer<typeof cardTabGroupPrefSchema>;
export type CardTabsPref = z.infer<typeof cardTabsPrefSchema>;
export type CardTabsPreferences = z.infer<typeof cardTabsPreferencesSchema>;
export type UiPreferences = z.infer<typeof uiPreferencesSchema>;

/**
 * Ответ GET/PUT `/api/v1/me/preferences` (#745): личные настройки и момент
 * последней записи. `updatedAt` — для last-write-wins и диагностики
 * («настройки пришли с другого компьютера»).
 */
export const userPreferencesResponseSchema = z.object({
  preferences: uiPreferencesSchema,
  updatedAt: z.iso.datetime(),
});

/** Тело PUT: полная замена личных настроек. `baseUpdatedAt` — подсказка
 *  клиенту; сервер применяет last-write-wins (конфликт-UI избыточен). */
export const updateUserPreferencesBodySchema = z
  .object({
    preferences: strictUiPreferencesSchema,
    baseUpdatedAt: z.iso.datetime().optional(),
  })
  .superRefine((body, ctx) => {
    const bytes = new TextEncoder().encode(JSON.stringify(body.preferences)).length;
    if (bytes > CARD_TABS_MAX_BYTES) {
      ctx.addIssue({
        code: 'custom',
        path: ['preferences'],
        message: `Настройки больше ${CARD_TABS_MAX_BYTES} байт`,
      });
    }
  });

export type UserPreferencesResponse = z.infer<typeof userPreferencesResponseSchema>;
export type UpdateUserPreferencesBody = z.infer<typeof updateUserPreferencesBodySchema>;
