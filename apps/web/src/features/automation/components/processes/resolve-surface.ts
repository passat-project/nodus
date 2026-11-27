import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';

/**
 * URL-модель единого входа «Процессы» (#857, единая модель §5) — чистый
 * разбор адреса в поверхность правой области. Приоритет: `ftype` (карточка
 * типа папки в раме) > `type` (редактор маршрута) > `ptype` (рабочая область
 * типа проекта) > `noproject` > умолчание. Дорожки «тип открыт из типа
 * проекта» нет (ревизия UI v3): связанная сущность открывается карточкой
 * поверх стека, поэтому `ptype` при наличии `type` не влияет. Идентификатор
 * пропал (архив) — откат к умолчанию; без права `project.setup.manage`
 * проектные ссылки игнорируются (сервер — истина, I8).
 */
export interface ProcessesSearch {
  tab?: string;
  /** Тип задачи/письма — редактор маршрута. */
  type?: string;
  /** Тип проекта — рабочая область (холст + страницы). */
  ptype?: string;
  /** Тип папки — карточка в раме (колонка стоит на месте). */
  ftype?: string;
  /** Страница «Без проекта». Тановский разбор адреса читает `1` как ЧИСЛО
   *  (JSON-семантика search-параметров), а `navigate` пишет строку —
   *  принимаем оба написания. */
  noproject?: string | number;
}

export type ProcessesSurface =
  | { surface: 'folder'; kindId: string }
  | { surface: 'type'; typeId: string }
  | { surface: 'project'; typeId: string }
  | { surface: 'no-project' }
  | { surface: 'empty' };

export interface ProcessesSurfaceData {
  processTypes: readonly ProcessType[];
  projectTypes: readonly ProjectType[];
  kinds: readonly NodeKind[];
  /** Право `project.setup.manage` — группы «Проекты» и «Папки». */
  canSetup: boolean;
}

/** Умолчание: первая живая строка «Проектов», иначе первый живой тип задач. */
export function defaultProcessesSurface(data: ProcessesSurfaceData): ProcessesSurface {
  const aliveProjects = data.projectTypes.filter((type) => type.archivedAt === null);
  if (data.canSetup && aliveProjects.length > 0) {
    return { surface: 'project', typeId: aliveProjects[0]!.id };
  }
  const firstTask = data.processTypes.find((type) => !type.archivedAt && type.category === 'task');
  return firstTask ? { surface: 'type', typeId: firstTask.id } : { surface: 'empty' };
}

export function resolveProcessesSurface(
  search: ProcessesSearch,
  data: ProcessesSurfaceData,
): ProcessesSurface {
  const aliveProject = (id: string | undefined) =>
    data.canSetup && id
      ? (data.projectTypes.find((type) => type.id === id && type.archivedAt === null) ?? null)
      : null;

  // Карточка типа папки: архивный тип открывается (внизу «Вернуть»), чужой
  // id — откат к умолчанию.
  if (data.canSetup && search.ftype) {
    const kind = data.kinds.find((entry) => entry.id === search.ftype);
    if (kind) return { surface: 'folder', kindId: kind.id };
  }

  if (search.type) {
    const type = data.processTypes.find((entry) => entry.id === search.type && !entry.archivedAt);
    if (type) return { surface: 'type', typeId: type.id };
  }

  const project = aliveProject(search.ptype);
  if (project) return { surface: 'project', typeId: project.id };

  if (search.noproject === '1' || search.noproject === 1) return { surface: 'no-project' };

  return defaultProcessesSurface(data);
}
