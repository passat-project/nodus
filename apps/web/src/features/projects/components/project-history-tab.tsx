import { Activity, FolderPlus, Pencil, Users } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import { formatDateTimeShort } from '../../../shared/lib/format.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { useInfiniteSentinel } from '../../../shared/views/use-infinite-sentinel.js';
import { useProjectHistory } from '../api/projects-api.js';
import { projectHistoryTitle } from '../lib/project-history.js';

const fieldLabels: Record<string, string> = {
  name: ui.projects.history.field.name,
  code: ui.projects.history.field.code,
  description: ui.projects.history.field.description,
  color: ui.projects.history.field.color,
  status: ui.projects.history.field.status,
  visibility: ui.projects.history.field.visibility,
  managerId: ui.projects.history.field.managerId,
  assistantIds: ui.projects.history.field.assistantIds,
  portfolioId: ui.projects.history.field.portfolioId,
  clientId: ui.projects.history.field.clientId,
  startDate: ui.projects.history.field.startDate,
  endDate: ui.projects.history.field.endDate,
};

const ICONS = {
  created: FolderPlus,
  updated: Pencil,
  status_changed: Activity,
  participants_changed: Users,
} as const;

/**
 * Вкладка «История» (вердикт владельца 07.11.2026): лента событий проекта
 * из outbox-журнала (I9) — создание, правки полей, статусы, состав. Своей
 * таблицы история не заводит: источник — те же события, что двигают
 * проекции. Новые первыми, добор — курсором при прокрутке.
 */
export function ProjectHistoryTab({ projectId }: { projectId: string }) {
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useProjectHistory(projectId);
  const { data: definitions } = useCustomFieldDefinitions('project');
  const entries = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  // Секретная эпоха (#748, вариант Б): у не-участника видимая лента начинается
  // с события раскрытия. Показываем подсказку, только когда догружена вся
  // лента и её старейшая запись — смена видимости (у участия внизу создание).
  const oldest = entries[entries.length - 1];
  const secretEraHidden =
    !hasNextPage && oldest?.kind === 'updated' && oldest.fields.includes('visibility');
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useInfiniteSentinel(containerRef, sentinelRef, {
    hasNextPage,
    isFetchingNextPage,
    onLoadMore: () => void fetchNextPage(),
  });

  function fieldLabel(field: string): string {
    if (field.startsWith('cf.')) {
      const id = field.slice(3);
      return definitions?.find((definition) => definition.id === id)?.name ?? field;
    }
    return fieldLabels[field] ?? field;
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-3xl">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <Empty>
            <EmptyTitle>{ui.projects.history.loadError}</EmptyTitle>
          </Empty>
        ) : entries.length === 0 ? (
          <Empty>
            <EmptyTitle>{ui.projects.history.empty}</EmptyTitle>
          </Empty>
        ) : (
          <ul className="flex flex-col">
            {entries.map((entry) => {
              const Icon = ICONS[entry.kind];
              return (
                <li
                  key={entry.id}
                  className="flex items-start gap-3 border-b border-border/60 px-2 py-2.5 last:border-b-0"
                >
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-accent/60 text-muted-foreground"
                  >
                    <Icon className="size-3.5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      {projectHistoryTitle(entry, fieldLabel)}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {entry.automatic ? (
                        <>
                          <span>{ui.projects.history.automatic}</span>
                          <span aria-hidden>·</span>
                        </>
                      ) : entry.actor ? (
                        <>
                          <PersonAvatar
                            name={entry.actor.displayName}
                            avatarUrl={entry.actor.avatarUrl}
                            className="size-4"
                          />
                          <span className="truncate">{entry.actor.displayName}</span>
                          <span aria-hidden>·</span>
                        </>
                      ) : (
                        <>
                          <span>{ui.projects.history.system}</span>
                          <span aria-hidden>·</span>
                        </>
                      )}
                      <span className="tabular-nums">{formatDateTimeShort(entry.createdAt)}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {secretEraHidden && oldest ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {ui.projects.history.openedAt.replace('{date}', formatDateTimeShort(oldest.createdAt))}
          </p>
        ) : null}

        {hasNextPage ? (
          <div ref={sentinelRef} className="flex justify-center py-2">
            {isFetchingNextPage ? <Skeleton className="h-8 w-40" /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
