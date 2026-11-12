import { NO_PORTFOLIO_FILTER } from '@nodus/contracts';
import type {
  ProjectGroup,
  ProjectListItem,
  ProjectPortfolioCount,
  ProjectStatus,
} from '@nodus/contracts';

/**
 * Папки-портфели журнала «Проекты» (#559, ADR-0030 доп. 02.11): портфель —
 * ПАПКА журнала, не раздел «Автоматизации». Чистая модель левой колонки:
 * «Все проекты», портфели со счётчиками (действует / всего), «Без портфеля»
 * и блок «Архив». Счётчики считает сервер (`GET /projects/groups/counts`) —
 * журнал листается курсором, из загруженной страницы полного числа не вывести.
 */

/** Выбор папки = значение фильтра журнала: uuid портфеля, `none` — без
 *  портфеля, `undefined` — «Все проекты». Сентинел — контракт API (#559). */
export { NO_PORTFOLIO_FILTER };

export type PortfolioCounters = Pick<ProjectPortfolioCount, 'active' | 'completed' | 'archived'>;

export interface PortfolioFolder {
  /** Ключ строки левой колонки: `all`, `none` или uuid портфеля. */
  id: string;
  name: string;
  /** null — «Все проекты» и «Без портфеля» (не портфель). */
  portfolioId: string | null;
  counters: PortfolioCounters;
  /** Папка в архиве: видна всегда — пустую папку тоже нужно вернуть. */
  archived: boolean;
}

export interface PortfolioFolderTree {
  all: PortfolioFolder;
  unassigned: PortfolioFolder;
  active: PortfolioFolder[];
  archived: PortfolioFolder[];
}

const ZERO: PortfolioCounters = { active: 0, completed: 0, archived: 0 };

export function totalOf(counters: PortfolioCounters): number {
  return counters.active + counters.completed + counters.archived;
}

function sumOf(items: readonly PortfolioCounters[]): PortfolioCounters {
  return items.reduce<PortfolioCounters>(
    (acc, item) => ({
      active: acc.active + item.active,
      completed: acc.completed + item.completed,
      archived: acc.archived + item.archived,
    }),
    { ...ZERO },
  );
}

/** Счётчики папки из ответа сервера (нет строки — нули, папка не исчезает). */
function countersOf(
  counts: readonly ProjectPortfolioCount[],
  portfolioId: string | null,
): PortfolioCounters {
  const hit = counts.find((entry) => entry.portfolioId === portfolioId);
  return hit
    ? { active: hit.active, completed: hit.completed, archived: hit.archived }
    : { ...ZERO };
}

/**
 * Левая колонка журнала: «Все проекты» (весь видимый срез), живые портфели
 * в серверном порядке (по имени), «Без портфеля» и ВСЕ архивные папки —
 * пустая архивная папка не исчезает: иначе её нечем вернуть из архива.
 */
export function buildPortfolioFolders(
  groups: readonly ProjectGroup[],
  counts: readonly ProjectPortfolioCount[],
): PortfolioFolderTree {
  const folderOf = (group: ProjectGroup): PortfolioFolder => ({
    id: group.id,
    name: group.name,
    portfolioId: group.id,
    counters: countersOf(counts, group.id),
    archived: group.archivedAt !== null,
  });
  const folders = groups.map(folderOf);
  const active = folders.filter((folder) => !folder.archived);
  const archived = folders.filter((folder) => folder.archived);
  return {
    all: {
      id: 'all',
      name: '',
      portfolioId: null,
      counters: sumOf(counts.map((entry) => entry)),
      archived: false,
    },
    unassigned: {
      id: NO_PORTFOLIO_FILTER,
      name: '',
      portfolioId: null,
      counters: countersOf(counts, null),
      archived: false,
    },
    active,
    archived,
  };
}

/** Значение фильтра «Портфель» по выбранной папке (`undefined` — все). */
export function portfolioFilterOf(folderId: string): string | undefined {
  return folderId === 'all' ? undefined : folderId;
}

/** Строки статусов внутри выбранной папки: «действует / завершён / в архиве». */
export function folderStatusRows(
  folder: PortfolioFolder | null,
): { status: ProjectStatus; count: number }[] {
  if (!folder) return [];
  return [
    { status: 'active', count: folder.counters.active },
    { status: 'completed', count: folder.counters.completed },
    { status: 'archived', count: folder.counters.archived },
  ];
}

/** Попадает ли строка журнала в выбранную папку (оптимистичные мутации, I4). */
export function inPortfolioFolder(
  project: Pick<ProjectListItem, 'portfolio'>,
  portfolioFilter: string | undefined,
): boolean {
  if (portfolioFilter === undefined) return true;
  if (portfolioFilter === NO_PORTFOLIO_FILTER) return project.portfolio === null;
  return project.portfolio?.id === portfolioFilter;
}
