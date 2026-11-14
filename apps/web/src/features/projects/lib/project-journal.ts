import type { ProjectListItem, ProjectStatus, ProjectVisibility } from '@nodus/contracts';

import { primaryProjectRole, type ProjectRole } from '../../../shared/lib/project-role.js';
import { inPortfolioFolder } from './portfolio-folders.js';

/** Роль в проекте для фильтра «Моя роль» (контракт query). */
export type ProjectRoleFilter = ProjectRole;

export { primaryProjectRole };

export interface ProjectJournalFilters {
  /** `all` — весь видимый срез (открытые + секретные моего участия). */
  scope: 'all' | 'mine';
  search?: string;
  role?: ProjectRoleFilter;
  visibility?: ProjectVisibility;
  status?: ProjectStatus;
  /** Папка-портфель: uuid портфеля или `none` — без портфеля (#559). */
  portfolioId?: string;
  /** Проекты сотрудника (вкладка «Проекты» карточки сотрудника). */
  memberId?: string;
  /** Проекты заказчика (вкладка «Проекты» карточки контрагента). */
  clientId?: string;
}

/** Параметры запроса журнала (пустые значения не уходят в URL). */
export function projectJournalParams(
  filters: ProjectJournalFilters,
): Record<string, string | undefined> {
  return {
    scope: filters.scope,
    search: filters.search?.trim() || undefined,
    role: filters.role,
    visibility: filters.visibility,
    status: filters.status,
    portfolioId: filters.portfolioId,
    memberId: filters.memberId,
    clientId: filters.clientId,
  };
}

/** URL страницы журнала (курсор — opaque-токен сервера). */
export function projectJournalUrl(
  params: Record<string, string | undefined>,
  cursor: string | null,
  limit = 50,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  query.set('limit', String(limit));
  if (cursor) query.set('cursor', cursor);
  return `/projects?${query}`;
}

/** Удовлетворяет ли строка фильтрам журнала (оптимистичная вставка новой
 *  записи только в подходящие кэши — канон patterns.md, I4). */
export function matchesProjectFilters(
  project: ProjectListItem,
  filters: ProjectJournalFilters,
): boolean {
  const q = filters.search?.trim().toLowerCase();
  if (q) {
    const haystack = `${project.code ?? ''} ${project.name}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filters.visibility && project.visibility !== filters.visibility) return false;
  if (filters.status && project.status !== filters.status) return false;
  if (filters.portfolioId && !inPortfolioFolder(project, filters.portfolioId)) return false;
  if (filters.clientId && project.client?.id !== filters.clientId) return false;
  // Превью обрезано (≤5): для оптимистичной вставки этого достаточно —
  // создатель/руководитель/помощники в него попадают всегда.
  if (filters.memberId && !project.membersPreview.some((m) => m.id === filters.memberId)) {
    return false;
  }
  const role = primaryProjectRole(project.myMembership);
  if (filters.role && role !== filters.role) return false;
  if (filters.scope === 'mine' && role === null) return false;
  return true;
}
