import type { TransitionFormInput, WorkflowDeciderFacts } from '@nodus/contracts';

import type { TransactionClient } from '../database/transaction-runner.js';

/**
 * Порт адаптера сущности для движка «Процессов» (ADR-0024, паттерн
 * contributors ADR-0012). Модуль-владелец сущности (`tasks`, позже
 * `correspondence`) регистрирует адаптер своей категории: движок не знает ни
 * таблиц, ни прав, ни ролей сущности — он спрашивает адаптер «кто актор»,
 * «какие факты гейтов», «примени стадию» и «перенеси сущности публикации».
 *
 * Регистрация — `DiscoveryService` по статическому маркеру
 * `static readonly workflowCategory` (тот же приём, что `eventType` у
 * обработчиков событий): @Global-токен не складывается из двух модулей, а
 * адаптеру нужны доменные провайдеры своего модуля. Движок вызывает методы
 * адаптера В ТРАНЗАКЦИИ ВЫЗЫВАЮЩЕГО — чужие таблицы не пишет.
 */

/** Факты сущности для гейтов DoR/DoD и пост-функций route_if. Реестр
 *  валидаторов закрыт (`workflowValidatorSchema`); адаптер категории
 *  заполняет те факты, которые его сущность умеет считать. */
export interface WorkflowGateFacts {
  stageId: string;
  acceptRequired: boolean;
  /** Постановщик сам себе исполнитель — особый случай route_if (#378). */
  creatorIsAssignee: boolean;
  /** Живые подзадачи фазы open (работа не сдана). */
  openSubtasks: number;
  /** Живые подзадачи фазы review (на утверждении) — мешают в строгом
   *  режиме гейта no_open_subtasks (ADR-0020, дополнение 2). */
  reviewSubtasks: number;
  checklistDone: number;
  checklistTotal: number;
  spentMinutes: number;
  description: string;
  deadline: Date | null;
  assigneeId: string | null;
  plannedMinutes: number | null;
  hasResult: boolean;
  /** Живых вложений текущей ревизии итога (#380): гейт `result_files`. */
  resultFileCount: number;
  /** Значения кастомных атрибутов сущности (#431, Р7): ключ — id атрибута. */
  customFields: Readonly<Record<string, unknown>>;
  /** Все id атрибутов области, включая скрытые: скрытый в условии гейта
   *  допустим, а неизвестный/удалённый ключ перехода не блокирует. */
  activeCustomFieldIds: ReadonlySet<string>;
}

/** Кто актор относительно сущности и что ему можно в маршруте. */
export interface WorkflowActorSubject {
  /** Маршрут, по которому сущность идёт сейчас. */
  workflowId: string;
  /** Тип процесса сущности: из его `config.numbering` движок берёт серию
   *  для пост-действия `assign_number` (#55). */
  typeId: string;
  /** Текущая стадия сущности. */
  stageId: string;
  /** Роли актора в словаре категории (задача — постановщик/ответственный/…). */
  roles: ReadonlySet<string>;
  /** Условия «кто» проходятся всегда (task.manage_any). */
  bypassConditions: boolean;
  /** Гейты можно обойти с причиной (task.override_gate). */
  canOverrideGates: boolean;
  /** Пустые условия «кто» означают «может» (постановщик/ответственный). */
  actsWithoutConditions: boolean;
  /** Права актора из токена — условия `permission` проверяет движок
   *  одинаково в `available` и `execute`; заполняет движок (адаптер прав
   *  портала не знает), поэтому поле необязательно у адаптера. */
  permissions?: readonly string[];
  /** Факты решающих (#433): кто актор вне задачи для этой сущности. Нет
   *  фактов — источники `decider_in` не совпадают (письма, чужие маршруты). */
  deciderFacts?: WorkflowDeciderFacts;
  /** Переходы текущей стадии, у которых ВСЕ источники решающих пусты (#433):
   *  показываются только с правом обхода и причиной. */
  vacantDeciderTransitionIds?: ReadonlySet<string>;
  facts: WorkflowGateFacts;
}

/** Стадия — то, что нужно для применения смены (данные модуля «Процессы»). */
export interface WorkflowEntityStage {
  id: string;
  /** Код системной стадии (null у пользовательских): письма различают
   *  «Не зарегистрировано» и «Ошибочно зарегистрировано» (#55, Р5).
   *  Необязателен — старые адаптеры его не читают. */
  code?: string | null;
  name: string;
  systemState: string;
  outcome: string | null;
}

/** Почему меняется стадия (поле `cause` событий сущности). */
export type WorkflowStageChangeCause = 'transition' | 'workflow_migration' | 'type_change';

export interface WorkflowStageChangeMeta {
  transitionId: string | null;
  cause: WorkflowStageChangeCause;
  /** Виды пройденных обходом гейтов (история и аудит). */
  overriddenGates?: string[];
  /** Текст причины обхода гейта (обязателен на API при обходе). */
  overrideReason?: string;
  /** Актор был решающим ЭТОГО перехода по состоянию до окна (#433):
   *  адаптер добавляет его наблюдателем без звука. */
  wasDeciderOfTransition?: boolean;
  /** Строка общего журнала (#380): блок в чате пишется только с ней. */
  recordId?: string;
  /** Названия кнопки и исходного статуса — для блока перехода в чате. */
  transitionName?: string;
  fromStageName?: string;
  /** Текст раздела «Причина / комментарий» окна и его подпись. */
  comment?: string;
  commentLabel?: string;
  /** Номер, выданный пост-действием `assign_number` (#55): адаптер письма
   *  пишет регистрационные поля в той же транзакции. */
  numbering?: {
    seriesId: string;
    year: number;
    seq: number;
    /** «Вх-2026/118». */
    display: string;
    assignedAt: Date;
  };
  /** Итог, созданный переходом (файлы — по живым вложениям). */
  result?: { resultId: string; fileCount: number; messageCount: number };
}

/** Что применило окно перехода (#380): дифф полей, запись времени, ревизия
 *  итога. Движок кладёт это в журнал и в событие; адаптер — единственный,
 *  кто пишет поля сущности (ADR-0024 п.3). */
export interface WorkflowFormApplied {
  /** Только реально изменённые поля: `{ deadline: { from, to } }`. */
  fields: Record<string, { from: unknown; to: unknown }>;
  timeEntryId: string | null;
  result: { resultId: string; fileCount: number; messageCount: number } | null;
}

export interface WorkflowActor {
  id: string;
  permissions: readonly string[];
}

export interface WorkflowEntityAdapter {
  /** Категория типа процесса (`task` | `letter`) — ключ реестра адаптеров. */
  readonly category: string;

  /** Блокировка строки сущности на время транзакции (сериализация переходов). */
  lock(tx: TransactionClient, entityId: string): Promise<void>;

  /** Актор, роли и факты гейтов на момент вызова (внутри транзакции). */
  subject(
    tx: TransactionClient,
    entityId: string,
    actor: WorkflowActor,
  ): Promise<WorkflowActorSubject>;

  /** Применить смену стадии в транзакции вызывающего (события, денормализации,
   *  проекции модуля-владельца — его забота). */
  applyStage(
    tx: TransactionClient,
    entityId: string,
    target: WorkflowEntityStage,
    actorId: string | null,
    meta: WorkflowStageChangeMeta,
  ): Promise<void>;

  /** Применить введённое в окне перехода (#380) в транзакции движка:
   *  поля, трудозатраты, ревизия итога. Права разделов перепроверяются
   *  здесь по свежим ролям; ошибка откатывает весь переход. */
  applyForm(
    tx: TransactionClient,
    entityId: string,
    actor: WorkflowActor,
    input: TransitionFormInput,
  ): Promise<WorkflowFormApplied>;

  /** Сколько сущностей в каждой из стадий (диалог публикации, мета списка). */
  countByStages(
    stageIds: readonly string[],
    tx?: TransactionClient,
  ): Promise<Record<string, number>>;

  /** Фоновый перенос сущностей архивированной стадии (своя транзакция на
   *  сущность, пачки; идемпотентно — повтор ничего не находит). */
  migrateStage(fromStageId: string, toStage: WorkflowEntityStage): Promise<number>;

  /** Пересчёт сущностей стадии после смены её системной группы (фоном). */
  restateStage(stageId: string, systemState: string): Promise<number>;
}
