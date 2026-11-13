import { z } from 'zod';
import {
  notificationKindSchema,
  notificationPrioritySchema,
  uiPreferencesSchema,
  viewFieldPrefsSchema,
  viewSortSchema,
} from '@nodus/contracts';

/**
 * Zod-валидация persist-сторов при rehydrate (I7 «zod на границах», аудит
 * #45 — КРИТИЧНО: navOrder:"строка" ронял весь портал в белый экран через
 * TypeError в resolveOrder). Zustand persist сам переживает лишь БИТЫЙ JSON;
 * валидный JSON с неверной формой (ручная правка, устаревший формат после
 * релиза, обрыв записи) без валидации молча смержился бы в state. Каждый
 * persist-стор валидирует сохранённое envelope-схемой: невалидный узел
 * отбрасывается на дефолт через .catch (гранулярность — один скоуп/вид,
 * соседние настройки не страдают). Envelope — клиентские обёртки над DTO
 * contracts (не API-контракты, потому живут здесь, а не в packages).
 * version: 1 у сторов без migrate: при смене версии zustand отбрасывает
 * сохранённое сам — смена формы состояния = bump версии, миграция не нужна,
 * пока настройки допустимо сбрасывать (до пилота — допустимо).
 */

/** Скоупы персонализации навигации: сломанный скоуп → {} (слой «не задан»). */
export const uiPrefsEnvelopeSchema = z.object({
  personal: uiPreferencesSchema.catch({}),
  company: uiPreferencesSchema.catch({}),
});

/** Настройки представлений: сломанный вид → {} (дефолт реестра полей). */
export const viewsEnvelopeSchema = z.object({
  views: z.record(z.string(), z.record(z.string(), viewFieldPrefsSchema).catch({})).catch({}),
  sorts: z.record(z.string(), viewSortSchema).catch({}),
});

/** Каркас (тема + служебная полоса + свёрнутость меню): сломанное поле →
 *  дефолт поля. Старый envelope без `menuCollapsed` валиден и даёт развёрнутое
 *  меню — продуктовый дефолт первого запуска (#722). */
export const shellEnvelopeSchema = z.object({
  theme: z.enum(['dark', 'light']).catch('light'),
  edgeOpen: z.boolean().catch(false),
  menuCollapsed: z.boolean().catch(false),
});

/** «Что нового» (#386): последний просмотренный выпуск по пользователю
 *  (userId → semver); сломанная карта → {} (покажем последний выпуск снова). */
export const whatsNewEnvelopeSchema = z.object({
  seen: z.record(z.string(), z.string()).catch({}),
});

/** Настройки ленты чата. */
export const chatPrefsEnvelopeSchema = z.object({
  align: z.enum(['one', 'both']).catch('one'),
});

/** Вкладки-фильтры ленты уведомлений (#189): кастомные вкладки + скрытые
 *  системные. «Все» скрывать нельзя — схема принимает только urgent/mentions;
 *  сломанная вкладка отбрасывается целиком (.catch), соседние выживают. */
export const notificationTabsEnvelopeSchema = z.object({
  custom: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(40),
        kinds: z.array(notificationKindSchema).catch([]),
        priorities: z.array(notificationPrioritySchema).catch([]),
      }),
    )
    .catch([]),
  hiddenSystem: z.array(z.enum(['urgent', 'mentions'])).catch([]),
});

/** Черновики композера (#87): текст + сериализуемый контекст reply/edit.
 *  Вложения НЕ персистятся (канон research: файлы черновика не переживают
 *  reload ни у кого) — partialize стора их отсекает. Сломанный черновик
 *  беседы отбрасывается, соседние живут. */
const chatDraftSchema = z.object({
  text: z.string().catch(''),
  // Реестр упоминаний черновика (#228): display-текст + диапазоны чипов.
  mentions: z
    .array(
      z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        id: z.string(),
        label: z.string(),
      }),
    )
    .catch([]),
  reply: z
    .object({
      messageId: z.string(),
      author: z.object({
        id: z.string(),
        displayName: z.string(),
        avatarUrl: z.string().nullable(),
      }),
      snippet: z.string(),
      quoteText: z.string().nullable(),
      // 'sticker' (#288): черновик ответа-на-стикер обязан переживать reload —
      // без значения enum разваливался весь reply-узел (.catch(null)).
      attachmentKind: z.enum(['image', 'file', 'sticker']).nullable(),
      // #288: мини-глиф оригинального стикера в цитате; битое значение →
      // null (глиф пропадает), а не весь черновик.
      stickerUrl: z.string().nullable().catch(null),
      stickerEmoji: z.string().nullable().catch(null),
      stickerMime: z.string().nullable().catch(null),
      inThread: z.string().nullable(),
    })
    .nullable()
    .catch(null),
  edit: z
    .object({
      messageId: z.string(),
      originalText: z.string(),
      originalIds: z.array(z.string()).catch([]),
    })
    .nullable()
    .catch(null),
  preEditText: z.string().nullable().catch(null),
});

export const chatDraftsEnvelopeSchema = z.object({
  drafts: z.record(z.string(), chatDraftSchema).catch({}),
});

/**
 * Фабрика merge-функции zustand persist: сохранённое состояние пропускается
 * через envelope-схему; невалидное целиком (не объект) → текущий дефолт.
 * Передавать в опцию `merge` persist-мидлвары с ЯВНЫМ типом полного стора:
 * `merge: zodPersistMerge<MyState>(myEnvelopeSchema)` — persisted-часть
 * (partialized) мёржится поверх current, функции стора не затрагиваются.
 */
export function zodPersistMerge<S extends object>(schema: z.ZodType<unknown>) {
  return (persisted: unknown, current: S): S => {
    const parsed = schema.safeParse(persisted);
    return parsed.success ? { ...current, ...(parsed.data as Partial<S>) } : current;
  };
}
