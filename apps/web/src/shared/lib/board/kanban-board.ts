import type { TaskListItem, TaskStage } from '@nodus/contracts';

/**
 * Борд канбана — плоский список задач: колонка = стадия, порядок внутри
 * колонки = порядок массива (persistится индексом в DTO переноса).
 * Чистые функции перестановок — для живой сортировки drag'ом и тестов.
 *
 * Ось борда (ADR-0008): глобальная (стадия workflow-схемы — степпер, проектная
 * доска) или личная (personalStageId — «Мой план»). Функции работают с осью
 * через стратегию keyOf/withStage и не знают, какая ось у конкретного борда.
 */
export interface BoardAxis {
  keyOf: (task: TaskListItem) => string | null;
  withStage: (task: TaskListItem, stage: TaskStage) => TaskListItem;
}

export const globalAxis: BoardAxis = {
  keyOf: (t) => t.stage.id,
  withStage: (t, stage) => ({ ...t, stage }),
};

export const personalAxis: BoardAxis = {
  keyOf: (t) => t.personalStageId,
  withStage: (t, stage) => ({ ...t, personalStageId: stage.id }),
};

/** Колонка под dnd-идентификатором: id колонки (дроп на пустую колонку /
 * на её фон) → сама колонка; id задачи → колонка задачи по оси; иначе —
 * undefined. Колонка распознаётся ДО поиска задачи: ось не знает «пустых»
 * задач — globalAxis на заглушке `{}` читал `stage.id` у undefined и ронял
 * проектный канбан TypeError-ом на дропе в пустую колонку. */
export function stageOfDragId<S extends TaskStage>(
  id: string,
  items: TaskListItem[],
  stageById: ReadonlyMap<string, S>,
  axis: BoardAxis,
): S | undefined {
  const column = stageById.get(id);
  if (column) return column;
  const task = items.find((t) => t.id === id);
  if (!task) return undefined;
  const key = axis.keyOf(task);
  return key === null ? undefined : stageById.get(key);
}

/** Позиция задачи внутри её колонки. */
export function indexOfInStage(items: TaskListItem[], taskId: string, axis: BoardAxis): number {
  const task = items.find((t) => t.id === taskId);
  if (!task) return -1;
  const key = axis.keyOf(task);
  return items.filter((t) => axis.keyOf(t) === key).findIndex((t) => t.id === taskId);
}

/** Перенос задачи в стадию на позицию index (живой перенос между колонками
 * и финализация дропа): задача вынимается, меняет стадию по оси и встаёт
 * перед якорем колонки либо в конец колонки. */
export function moveTaskToStage(
  items: TaskListItem[],
  taskId: string,
  stage: TaskStage,
  index: number,
  axis: BoardAxis,
): TaskListItem[] {
  const task = items.find((t) => t.id === taskId);
  if (!task) return items;
  const moved: TaskListItem = axis.withStage(task, stage);
  const rest = items.filter((t) => t.id !== taskId);
  const column = rest.filter((t) => axis.keyOf(t) === stage.id);
  const anchor = column[index];
  if (anchor) {
    const at = rest.indexOf(anchor);
    return [...rest.slice(0, at), moved, ...rest.slice(at)];
  }
  if (column.length > 0) {
    const last = column[column.length - 1];
    if (last) {
      const at = rest.indexOf(last) + 1;
      return [...rest.slice(0, at), moved, ...rest.slice(at)];
    }
  }
  return [...rest, moved];
}

/** Одинаковое ли РАЗМЕЩЕНИЕ задач (порядок id + колонка каждой по оси) —
 * предохранитель холостых setState: идентичный результат перестановки не
 * должен создавать новое состояние (пустые витки измерение→onDragOver→
 * setState — топливо цикла update depth). Сравнивать ТОЛЬКО порядок id
 * нельзя (регрессионный тест): переезд между пустыми колонками ставит задачу
 * в конец плоского массива оба раза — порядок id совпадает, гейт глотал
 * setState, стадия в состоянии не обновлялась и персист уходил со старой
 * колонкой (баг «дроп в пустую колонку не применяется», gotchas). */
export function isSamePlacement(a: TaskListItem[], b: TaskListItem[], axis: BoardAxis): boolean {
  return (
    a.length === b.length &&
    a.every((t, i) => t.id === b[i]?.id && axis.keyOf(t) === axis.keyOf(b[i]))
  );
}
