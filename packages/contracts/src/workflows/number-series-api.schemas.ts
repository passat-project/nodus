import { z } from 'zod';

import {
  NUMBER_CONTAINERS_MAX,
  numberContainerEntitySchema,
  numberContainerMissingReasonSchema,
  numberHostKindSchema,
} from './number-container.js';
import {
  NUMBER_TEMPLATE_LIMITS,
  numberFieldSourceSchema,
  numberSeriesRuleSchema,
} from './number-series.schemas.js';

/**
 * API счётчиков (#630, модель v3): «Текущие счета» атрибута, «Следующий
 * номер» любого счёта (только вперёд), «Проверка на записи», охват правила,
 * выдача существующим записям (окно с одобрением) и номера одной записи
 * (карточка «выдан в КЖ-01», окно переноса). Права: настройка и счета —
 * `custom_field.manage`; номера записи — тем, кто видит запись.
 */

/** Значение условия, как его видит человек: имя и путь по дереву.
 *  `hidden` — секретный проект, которого смотрящий не видит: имя и путь
 *  не раскрываются («Скрытый проект»), счёт виден. */
export const numberContainerRefSchema = z.object({
  entity: numberContainerEntitySchema,
  id: z.uuid(),
  name: z.string(),
  /** Путь от проекта вниз («ЖК Минск-Мир › Здание 1»), без самого значения. */
  path: z.array(z.string()),
  hidden: z.boolean(),
  /** Запись удалена (пустую папку удалить можно) — счёт остаётся в истории. */
  deleted: z.boolean(),
});
export type NumberContainerRef = z.infer<typeof numberContainerRefSchema>;

/** Один счёт атрибута: значения условий × период. Пустой список — сквозная. */
export const numberCountSchema = z.object({
  containers: z.array(numberContainerRefSchema).max(NUMBER_CONTAINERS_MAX),
  /** '' (никогда не заново), '2026', '2026-Q1', '2026-11', '2026-11-08'. */
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
  /** Поиск по имени значения условия (папка, проект, портфель…). */
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
 *  или с бумаги — общего счёта или конкретной папки/проекта, у которой счёта
 *  ещё нет («КЖ-01 на бумаге дошёл до Изм. 4»). Значения условий — в порядке
 *  правила; счёт текущего периода по поясу компании. Меньше уже выданного —
 *  409 `NUMBER_NEXT_BACKWARDS`; значение не того вида — 422. */
export const setNumberNextBodySchema = z
  .object({
    containerIds: z.array(z.uuid()).max(NUMBER_CONTAINERS_MAX),
    nextValue: z.number().int().min(1).max(NUMBER_TEMPLATE_LIMITS.value),
  })
  .strict();
export type SetNumberNextBody = z.infer<typeof setNumberNextBodySchema>;

/** «Проверка на записи»: конкретная запись → значения её условий → какой
 *  номер она получит. `rule` — правило черновика окна (несохранённое);
 *  `definitionId` — сохранённый атрибут (его счета). Номер НЕ тратится. */
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
    /** Название записи для строки «Задача «…» → КЖ-01 → Изм. 3». */
    hostName: z.string(),
    containers: z.array(numberContainerRefSchema).max(NUMBER_CONTAINERS_MAX),
    nextDisplay: z.string(),
    /** У записи номер уже есть — никакой способ выдачи его не изменит. */
    alreadyAssigned: z.string().nullable(),
    /** Имена атрибутов-вставок, пустых у этой записи (выдача спросит). */
    emptySegments: z.array(z.string()),
  }),
  z.object({
    ok: z.literal(false),
    hostName: z.string(),
    /** `not_participant` — тип записи не получает этот номер. */
    reason: z.union([numberContainerMissingReasonSchema, z.literal('not_participant')]),
  }),
]);
export type NumberPreviewResult = z.infer<typeof numberPreviewResultSchema>;

/** Запись-пример в охвате и выдаче существующим. */
export const numberHostSampleSchema = z.object({
  kind: numberHostKindSchema,
  id: z.uuid(),
  name: z.string(),
  reason: numberContainerMissingReasonSchema,
});
export type NumberHostSample = z.infer<typeof numberHostSampleSchema>;

/** «Охват» правила: сколько СУЩЕСТВУЮЩИХ записей отмеченных типов лежат
 *  внутри выбранных условий и какие — нет (правила вложенности видов папок в
 *  системе нет). Примеры — только записи, видимые смотрящему; невидимые
 *  (секретные проекты, конфиденциальные задачи) — только числом. */
export const numberCoverageBodySchema = z
  .object({
    rule: numberSeriesRuleSchema,
    participantTypeIds: z.array(z.uuid()).max(200),
  })
  .strict();
export type NumberCoverageBody = z.infer<typeof numberCoverageBodySchema>;

export const numberCoverageResultSchema = z.object({
  total: z.number().int().min(0),
  inside: z.number().int().min(0),
  /** До 5 видимых записей, которые номер не получат. */
  outside: z.array(numberHostSampleSchema),
  /** Сколько не получат номер среди невидимых смотрящему записей. */
  hiddenOutside: z.number().int().min(0),
});
export type NumberCoverageResult = z.infer<typeof numberCoverageResultSchema>;

/** Выдача номеров СУЩЕСТВУЮЩИМ записям без номера (вердикт владельца
 *  08.11): только из настройки счётчика — всплывающее окно с предпросмотром
 *  и кнопкой одобрения; в карточках кнопки нет. Порядок — по дате создания.
 *  Номера выдаются навсегда, отменить нельзя. */
export const numberBackfillGroupSchema = z.object({
  containers: z.array(numberContainerRefSchema).max(NUMBER_CONTAINERS_MAX),
  count: z.number().int().min(1),
  firstDisplay: z.string(),
  lastDisplay: z.string(),
});
export type NumberBackfillGroup = z.infer<typeof numberBackfillGroupSchema>;

export const numberBackfillPreviewSchema = z.object({
  /** Получат номер (видимые и невидимые вместе). */
  total: z.number().int().min(0),
  /** Счета, в которые лягут номера (до 20 крупнейших). */
  groups: z.array(numberBackfillGroupSchema),
  /** Не получат: лежат вне условий (до 5 видимых примеров). */
  blocked: z.array(numberHostSampleSchema),
  blockedTotal: z.number().int().min(0),
  /** Из получающих — сколько с пустым полем-вставкой (номер выйдет без него). */
  emptyParts: z.number().int().min(0),
});
export type NumberBackfillPreview = z.infer<typeof numberBackfillPreviewSchema>;

export const numberBackfillBodySchema = z
  .object({
    /** Сколько записей видел администратор в предпросмотре: изменилось —
     *  409 `NUMBER_BACKFILL_STALE`, окно показывает свежий предпросмотр. */
    expectedTotal: z.number().int().min(1),
    /** Выдать и тем, у кого поле-вставка пусто (иначе они пропускаются). */
    confirmEmptyNumberParts: z.literal(true).optional(),
  })
  .strict();
export type NumberBackfillBody = z.infer<typeof numberBackfillBodySchema>;

export const numberBackfillResultSchema = z.object({ issued: z.number().int().min(0) });
export type NumberBackfillResult = z.infer<typeof numberBackfillResultSchema>;

/** Кнопка маршрута, которая выдаёт номер этого атрибута (опубликованный
 *  маршрут, пост-функция `assign_number` с `fieldId`). */
export const numberIssuerSchema = z.object({
  processTypeId: z.uuid(),
  transitionId: z.string(),
  transitionName: z.string(),
});
export type NumberIssuer = z.infer<typeof numberIssuerSchema>;

/** Каким способом выдан номер (журнал `number_assignments.source`). */
export const numberIssueSourceSchema = z.enum([
  'create',
  'type_change',
  'transition',
  'backfill',
  'rule',
  'registry',
  'import',
]);
export type NumberIssueSource = z.infer<typeof numberIssueSourceSchema>;

/** Номера одной записи — карточка («выдан в КЖ-01», кто и когда) и окно
 *  переноса («номер останется прежним»). */
export const numberHostAssignmentSchema = z.object({
  fieldId: z.uuid(),
  display: z.string(),
  containers: z.array(numberContainerRefSchema).max(NUMBER_CONTAINERS_MAX),
  periodKey: z.string(),
  assignedAt: z.iso.datetime(),
  actorName: z.string().nullable(),
  source: numberIssueSourceSchema,
  /** Название кнопки на момент выдачи (у `transition`), иначе null. */
  sourceLabel: z.string().nullable(),
});
export type NumberHostAssignment = z.infer<typeof numberHostAssignmentSchema>;

export const numberHostAssignmentsSchema = z.object({
  items: z.array(numberHostAssignmentSchema),
});
export type NumberHostAssignments = z.infer<typeof numberHostAssignmentsSchema>;

/** `details` ответа 409 NUMBER_CONTAINER_MISSING (создание, кнопка, смена
 *  типа): какой номер и почему не нашёл места — для понятного отказа
 *  «Номер «Изм.» не выдан: запись не лежит в папке вида «Комплект»». */
export const numberContainerMissingDetailsSchema = z.object({
  fieldId: z.uuid(),
  fieldName: z.string(),
  reason: numberContainerMissingReasonSchema,
  /** Номер условия в `containers` правила. */
  index: z.number().int().min(0),
  /** Имя ненайденного: вид папки или поле; у прочих условий — ''. */
  name: z.string(),
});
export type NumberContainerMissingDetails = z.infer<typeof numberContainerMissingDetailsSchema>;

/** `details` ответа 409 NUMBER_SEGMENT_EMPTY: какие поля-вставки пусты и
 *  каким выйдет номер — окно «Выдать так / Вернуться и заполнить»; повтор
 *  того же запроса с `confirmEmptyNumberParts: true` выдаёт номер. */
export const numberSegmentEmptyDetailsSchema = z.object({
  fieldId: z.uuid(),
  fieldName: z.string(),
  segments: z
    .array(
      z.object({
        fieldNumber: z.number().int().min(1),
        source: numberFieldSourceSchema,
        name: z.string(),
      }),
    )
    .min(1),
  /** Номер, который выйдет с пустыми вставками («-1»). */
  example: z.string(),
});
export type NumberSegmentEmptyDetails = z.infer<typeof numberSegmentEmptyDetailsSchema>;
