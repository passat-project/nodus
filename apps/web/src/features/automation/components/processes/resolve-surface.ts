import type { NodeKind, ProcessType, ProjectType } from '@nodus/contracts';

/**
 * URL-модель единого входа «Процессы» (#857, единая модель §5) — чистый
 * разбор адреса в поверхность правой области. Приоритет: `ftype` (экран
 * типа папки на всю область) > `type` (редактор маршрута) > `ptype`
 * (рабочая область типа проекта) > `noproject` > умолчание. Идентификатор
 * пропал (архив) — откат к умолчанию; без права `project.setup.manage`
 * проектные ссылки игнорируются (сервер — истина, I8).
 */
export interface ProcessesSearch {
  tab?: string;
  /** Тип задачи/письма — редактор маршрута. */
  type?: string;
  /** Тип проекта — рабочая область (холст + страницы). */
  ptype?: string;
  /** Тип папки — экран на всю рабочую область (колонка скрыта). */
  ftype?: string;
  /** Страница «Без проекта». */
  noproject?: string;
}

export type ProcessesSurface =
  | { surface: 'folder'; kindId: string }
  | { surface: 'type'; typeId: string; trailTypeId: string | null }
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
  return firstTask
    ? { surface: 'type', typeId: firstTask.id, trailTypeId: null }
    : { surface: 'empty' };
}

export function resolveProcessesSurface(
  search: ProcessesSearch,
  data: ProcessesSurfaceData,
): ProcessesSurface {
  const aliveProject = (id: string | undefined) =>
    data.canSetup && id
      ? (data.projectTypes.find((type) => type.id === id && type.archivedAt === null) ?? null)
      : null;

  // Экран типа папки: архивный тип открывается (внизу «Вернуть»), чужой id —
  // откат к умолчанию.
  if (data.canSetup && search.ftype) {
    const kind = data.kinds.find((entry) => entry.id === search.ftype);
    if (kind) return { surface: 'folder', kindId: kind.id };
  }

  if (search.type) {
    const type = data.processTypes.find((entry) => entry.id === search.type && !entry.archivedAt);
    if (type) {
      // Дорожка «Договор → Задание смежнику»: тип открыт из типа проекта.
      const trail = aliveProject(search.ptype);
      return { surface: 'type', typeId: type.id, trailTypeId: trail?.id ?? null };
    }
  }

  const project = aliveProject(search.ptype);
  if (project) return { surface: 'project', typeId: project.id };

  if (search.noproject === '1') return { surface: 'no-project' };

  return defaultProcessesSurface(data);
}
