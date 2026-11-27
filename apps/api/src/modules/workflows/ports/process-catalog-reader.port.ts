import type { ProcessCategory, ProcessType, ProcessTypeRef } from '@nodus/contracts';

/**
 * Read-порт «Процессов» для модулей-владельцев сущностей (ADR-0012,
 * ADR-0024): гидратация типов и стадий в DTO, разрешение типа в маршрут с
 * проверкой категории/архива/скрытости, каталог стадий. Модуль-владелец
 * таблицы `process_types` / `workflows` / `workflow_stages` не трогает.
 */
export const PROCESS_CATALOG_READER = Symbol('PROCESS_CATALOG_READER');

/** Стадия маршрута в форме модуля-владельца (DTO `TaskStage` собирается им). */
export interface CatalogStage {
  id: string;
  workflowId: string;
  code: string | null;
  name: string;
  color: string;
  sortOrder: number;
  systemState: string;
  outcome: string | null;
  isInitial: boolean;
  archivedAt: Date | null;
}

/** Стадия в межтиповом каталоге (`GET /tasks/stages` без typeId). */
export interface CatalogStageWithType extends CatalogStage {
  typeId: string;
  typeName: string;
}

/** Минимальные флаги живой стадии (#435): перевод предикатов списков
 * (outcome / «результат выдан» / живость stage_id) в множества stage_id. */
export interface CatalogStageFlag {
  id: string;
  workflowId: string;
  sortOrder: number;
  systemState: string;
  outcome: string | null;
  resultIssued: boolean;
}

export interface ProcessCatalogReader {
  /** Тип по id (по умолчанию — системный «Стандартный») с маршрутом и
   *  опубликованной формой создания. `category` — ожидаемая категория
   *  сущности: тип чужой категории — 404 (задача не может идти по маршруту
   *  письма). `requireCreatable` — явный выбор типа при создании/смене.
   *  `actorId` — проверка доступа (#432, Р6): не видит тип — 403
   *  `PROCESS_TYPE_FORBIDDEN` с `reason: 'view'`, не может создавать —
   *  403 с `reason: 'not_creatable'`. Без `actorId` (внутренние вызовы, где
   *  доступ проверен выше) — прежнее поведение: скрытый тип — 409. */
  resolveType(
    typeId: string | undefined,
    opts: { category: ProcessCategory; requireCreatable?: boolean; actorId?: string },
  ): Promise<ProcessType>;

  /** Тип по id (живой или архивный) — настройки, смена типа, история. */
  typeById(id: string): Promise<ProcessType | null>;

  /** Живой тип по системному коду (`letter-incoming`) — системные приёмы
   *  (#56: поллер почты создаёт письма типом по умолчанию, без пользователя).
   *  Чужая категория или архив — null. */
  resolveTypeByCode(code: string, opts: { category: ProcessCategory }): Promise<ProcessType | null>;

  /** Ссылки на типы пачкой (гидратация строк DTO). `live` — только живые:
   *  привязка атрибута к архивному типу — мёртвая настройка (#432). */
  typeRefs(ids: readonly string[], opts?: { live?: boolean }): Promise<ProcessTypeRef[]>;

  /** Живые стадии маршрута по порядку (выбор стадии при создании/смене типа). */
  liveStages(workflowId: string): Promise<CatalogStage[]>;

  /** Стадии по id пачкой, включая архивные (гидратация DTO: история живёт). */
  stagesByIds(ids: readonly string[]): Promise<CatalogStage[]>;

  /** Живая стадия по id (цель переноса, смена типа); архивная — null. */
  findLiveStage(stageId: string): Promise<CatalogStage | null>;

  /** Стадии одного типа (с typeId/typeName) или всех живых типов категории —
   *  межтиповой фильтр «Тип · Статус»; счётчики считает модуль-владелец.
   *  `viewerId` — только видимые смотрящему типы (#432, Р6): каталог стадий
   *  не раскрывает названия невидимых типов. */
  stagesCatalog(opts: {
    typeId?: string;
    category: ProcessCategory;
    viewerId?: string;
  }): Promise<CatalogStageWithType[]>;

  /** Живые стадии всех живых типов категории одним набором (#435):
   *  предикаты списков (outcome / result_issued / stage_is) переводятся в
   *  множества stage_id по этим флагам. Имена/цвета не нужны — только
   *  системные флаги, один запрос на категорию. */
  liveStageFlags(category: ProcessCategory): Promise<CatalogStageFlag[]>;
}
