/**
 * Read-порт видимости задач для поиска (#952, ADR-0012). Отдаёт ТЕ ЖЕ наборы,
 * что `Viewer` внутри `visibleTasksWhere` (`access/task-visibility.ts`), чтобы
 * ядро search строило pre-filter, не копируя правила и не читая таблицы задач
 * (I3/I6). Владелец данных — tasks: реализация `task-viewer.provider.ts`,
 * экспорт — `TasksPortsModule`.
 *
 * Соответствие `visibleTasksWhere(viewer, 'all')`:
 * - `subordinateIds` — ветка «руководитель по оргструктуре» (гейтится
 *   `confidential=false` и `hiddenProjectIds`);
 * - `visibleProjectIds` — ветка «видимый проект» (гейтится `confidential`);
 * - `hiddenProjectIds` — скрытые секретные проекты: ветви подчинённых и
 *   проектов гейтятся, «моё участие» тоже (исключённый из проекта теряет
 *   доступ к его задачам);
 * - `deciderTaskIds` — решающий текущего шага;
 * - `pressTaskIds` — внешний участник сбора отметок;
 * - `viewAll` — право `task.view_all` (не раскрывает конфиденциальные и
 *   скрытые секретные).
 */
export const TASK_VIEWER_READER = Symbol('TASK_VIEWER_READER');

export interface TaskSearchScope {
  userId: string;
  subordinateIds: string[];
  visibleProjectIds: string[];
  hiddenProjectIds: string[];
  deciderTaskIds: string[];
  pressTaskIds: string[];
  viewAll: boolean;
}

export interface TaskViewerReader {
  /** Наборы видимости для pre-filter поиска; при выключенном флаге `tasks` —
   *  пустой набор (тип задачи и так исключён из `enabledTypes`). */
  resolve(actor: { id: string; permissions: readonly string[] }): Promise<TaskSearchScope>;
}
