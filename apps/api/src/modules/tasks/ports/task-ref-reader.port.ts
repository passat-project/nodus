import type { InjectionToken } from '@nestjs/common';

/**
 * Read-порт задач для ссылок-значений атрибутов (Р5 #631): валидатор
 * значений и гидратор ссылок модуля custom-fields проверяют цель-задачу и
 * читают её название через этот порт, не трогая таблицы задач (I3).
 * Критерии — план #631 §6: существует и не удалена; конфиденциальная —
 * только участникам (иначе цель «не существует», без оракула секретности).
 */
export const TASK_REF_READER: InjectionToken = 'TASK_REF_READER';

/** Актёр запроса: id + права из токена (для view-надзора). */
export interface TaskRefViewer {
  id: string;
  permissions: readonly string[];
}

/** Ссылка на задачу для значений атрибутов: имя показывается только при
 *  доступе; `deleted` — мягко удалённая цель («запись удалена»). */
export interface TaskRefInfo {
  id: string;
  name: string;
  deleted: boolean;
}

export interface TaskRefReader {
  /** Задачи по id (включая мягко удалённые — различие «нет доступа» и
   *  «запись удалена»); пустой список — быстрый выход. */
  refs(taskIds: readonly string[]): Promise<TaskRefInfo[]>;

  /** Видима ли задача актёру (существует, не удалена; конфиденциальная —
   *  участник или надзор). */
  visibleFor(taskId: string, viewer: TaskRefViewer): Promise<boolean>;

  /** Батч видимости (#641): один SQL на пачку вместо запроса на ссылку.
   *  `includeDeleted` — «была видима до удаления»: только для плашки
   *  «запись удалена» (оракул не раскрывается — невидимая цель не входит). */
  visibleForMany(
    taskIds: readonly string[],
    viewer: TaskRefViewer,
    opts?: { includeDeleted?: boolean },
  ): Promise<ReadonlySet<string>>;
}
