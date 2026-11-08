import { z } from 'zod';

import { numberContainerMissingReasonSchema, numberHostKindSchema } from './number-container.js';
import { NUMBER_TEMPLATE_LIMITS, numberSeriesRuleSchema } from './number-series.schemas.js';

/**
 * API счётчиков (#630, концепция 08.11): «Текущие счета» атрибута, «Следующий
 * номер» счёта (только вперёд), «Проверка на записи» (запись → её реальный
 * контейнер → следующий номер) и «кто выдаёт» (кнопки маршрутов). Права:
 * чтение — `custom_field.manage`, правка следующего номера — та же.
 */

/** Контейнер счёта, как его видит администратор: имя и путь по дереву.
 *  `hidden` — секретный проект, которого администратор не видит: имя и путь
 *  не раскрываются («Скрытый проект»), счёт виден. */
export const numberContainerRefSchema = z.object({
  kind: z.enum(['folder', 'project', 'project_type', 'portfolio', 'parent_task', 'field']),
  id: z.uuid(),
  name: z.string(),
  /** Путь от проекта вниз («ЖК Минск-Мир › Здание 1»), без самого контейнера. */
  path: z.array(z.string()),
  hidden: z.boolean(),
  /** Контейнер удалён (пустую папку удалить можно) — счёт остаётся в истории. */
  deleted: z.boolean(),
});
export type NumberContainerRef = z.infer<typeof numberContainerRefSchema>;

/** Один счёт атрибута: контейнер × период. `container: null` — вся компания. */
export const numberCountSchema = z.object({
  container: numberContainerRefSchema.nullable(),
  /** '' (никогда не заново), '2026', '2026-11'. */
  periodKey: z.string(),
  /** Последний выданный порядковый номер (0 — ещё не выдавали, но задан
   *  следующий номер вручную). */
  lastValue: z.number().int().min(0),
  lastDisplay: z.string().nullable(),
  nextValue: z.number().int().min(1),
  nextDisplay: z.string(),
});
export type NumberCount = z.infer<typeof numberCountSchema>;

export const numberCountsQuerySchema = z.object({
  /** Поиск по имени контейнера (папка, проект, портфель). */
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type NumberCountsQuery = z.infer<typeof numberCountsQuerySchema>;

export const numberCountsResponseSchema = z.object({
  items: z.array(numberCountSchema),
  nextCursor: z.string().nullable(),
  /** Счетов всего и выдано номеров всеми счетами атрибута. */
  totals: z.object({ counts: z.number().int().min(0), issued: z.number().int().min(0) }),
});
export type NumberCountsResponse = z.infer<typeof numberCountsResponseSchema>;

/** «Следующий номер» счёта — только вперёд: продолжение нумерации из Excel
 *  или с бумаги для общего счёта или конкретной папки. Счёт текущего периода
 *  (год/месяц по поясу компании). Меньше уже выданного — 409
 *  `NUMBER_NEXT_BACKWARDS` (номера не переиспользуются). */
export const setNumberNextBodySchema = z
  .object({
    /** null — общий счёт (вся компания). */
    containerId: z.uuid().nullable(),
    nextValue: z.number().int().min(1).max(NUMBER_TEMPLATE_LIMITS.value),
  })
  .strict();
export type SetNumberNextBody = z.infer<typeof setNumberNextBodySchema>;

/** «Проверка на записи»: конкретная запись → её реальный контейнер → какой
 *  номер она получит. `rule` — правило черновика окна (несохранённое);
 *  `definitionId` — сохранённый атрибут (его счета и привязки). Номер НЕ
 *  тратится — только предпросмотр. */
export const numberPreviewBodySchema = z
  .object({
    definitionId: z.uuid().optional(),
    rule: numberSeriesRuleSchema,
    /** Типы, получающие номер (черновик «Кто получает номер»). */
    participantTypeIds: z.array(z.uuid()).max(200),
    host: z.object({ kind: numberHostKindSchema, id: z.uuid() }).strict(),
  })
  .strict();
export type NumberPreviewBody = z.infer<typeof numberPreviewBodySchema>;

export const numberPreviewResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    /** Название записи для строки «Задача «…» → папка КЖ-01 → Изм. 3». */
    hostName: z.string(),
    container: numberContainerRefSchema.nullable(),
    nextDisplay: z.string(),
    /** У записи номер уже есть — кнопка его не изменит. */
    alreadyAssigned: z.string().nullable(),
  }),
  z.object({
    ok: z.literal(false),
    hostName: z.string(),
    /** `not_participant` — тип записи не получает этот номер. */
    reason: z.union([numberContainerMissingReasonSchema, z.literal('not_participant')]),
  }),
]);
export type NumberPreviewResult = z.infer<typeof numberPreviewResultSchema>;

/** Кнопка маршрута, которая выдаёт номер этого атрибута (опубликованный
 *  маршрут, пост-функция `assign_number` с `fieldId`). */
export const numberIssuerSchema = z.object({
  processTypeId: z.uuid(),
  transitionId: z.string(),
  transitionName: z.string(),
});
export type NumberIssuer = z.infer<typeof numberIssuerSchema>;
