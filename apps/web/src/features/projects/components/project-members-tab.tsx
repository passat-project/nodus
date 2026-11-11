import { Trash2 } from 'lucide-react';
import { useMemo, useRef } from 'react';
import type { ProjectDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Empty, EmptyDescription, EmptyTitle } from '@nodus/ui/components/empty';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { useInfiniteSentinel } from '../../../shared/views/use-infinite-sentinel.js';
import { useRemoveProjectMember } from '../api/project-member-mutations.js';
import { useProjectMembers } from '../api/projects-api.js';
import { AddProjectMemberButton } from './project-add-member-button.js';
import {
  groupProjectMembers,
  manualMembershipKind,
  memberRemovalLabel,
  taskParticipantIds,
  type ProjectMemberGroup,
} from '../lib/project-members.js';

const SOURCE_TONE = {
  manager: 'success',
  assistant: 'info',
  member: 'muted',
  task: 'muted',
  observer: 'muted',
} as const;

/**
 * Вкладка «Участники» (Р2 #52; вердикт 07.11.2026): открытый проект — живой
 * состав из задач + ручные НАБЛЮДАТЕЛИ (руководство добавляет их кнопкой:
 * клик сразу открывает поповер с множественным выбором, без инлайн-формы и
 * прыжков верстки); секретный — ручные участники и наблюдатели. Строки
 * группируются по сотруднику, у каждого — чипы всех источников.
 */
export function ProjectMembersTab({ project }: { project: ProjectDetail }) {
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useProjectMembers(
    project.id,
  );
  const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const groups = useMemo(() => groupProjectMembers(rows), [rows]);
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useInfiniteSentinel(containerRef, sentinelRef, {
    hasNextPage,
    isFetchingNextPage,
    onLoadMore: () => void fetchNextPage(),
  });
  const openCard = useOpenCard();
  const remove = useRemoveProjectMember(project.id);
  const secret = project.visibility === 'secret';
  const canManage = project.access.canManageMembers;
  const managementIds = rows
    .filter((row) => row.source === 'manager' || row.source === 'assistant')
    .map((row) => row.user.id);
  // Открытый проект: участнику из задач наблюдателя не выдают — роль не
  // добавляет доступа (#714); сервер тоже отклонит, пикер не должен предлагать.
  const observerExcludeIds = secret
    ? managementIds
    : [...managementIds, ...taskParticipantIds(rows)];
  const manualIds = (kind: 'member' | 'observer') =>
    rows.filter((row) => row.source === kind).map((row) => row.user.id);

  return (
    <div ref={containerRef} className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          {secret ? ui.projects.membersHintSecret : ui.projects.membersHintOpen}
        </p>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            {secret ? (
              <AddProjectMemberButton
                projectId={project.id}
                kind="member"
                selectedIds={manualIds('member')}
                excludeIds={managementIds}
              />
            ) : null}
            <AddProjectMemberButton
              projectId={project.id}
              kind="observer"
              selectedIds={manualIds('observer')}
              excludeIds={observerExcludeIds}
            />
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <Empty>
            <EmptyTitle>{ui.projects.membersEmpty}</EmptyTitle>
            <EmptyDescription>{ui.projects.membersHintOpen}</EmptyDescription>
          </Empty>
        ) : (
          <ul className="flex flex-col">
            {groups.map((group) => {
              const removeKind =
                group.sources.includes('manager') || group.sources.includes('assistant')
                  ? null
                  : manualMembershipKind(group);
              return (
                <MemberRow
                  key={group.user.id}
                  group={group}
                  removeKind={canManage ? removeKind : null}
                  onOpen={() => openCard({ kind: 'employee', id: group.user.id })}
                  onRemove={() => {
                    if (removeKind) remove.mutate({ userId: group.user.id, kind: removeKind });
                  }}
                />
              );
            })}
          </ul>
        )}

        {hasNextPage ? (
          <div ref={sentinelRef} className="flex justify-center py-2">
            {isFetchingNextPage ? <Skeleton className="h-8 w-40" /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MemberRow({
  group,
  removeKind,
  onOpen,
  onRemove,
}: {
  group: ProjectMemberGroup;
  removeKind: 'member' | 'observer' | null;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const removeLabel = removeKind ? memberRemovalLabel(removeKind) : null;
  return (
    <li className="group flex h-12 items-center gap-3 border-b border-border/60 px-2 last:border-b-0 hover:bg-accent/40">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <PersonAvatar
          name={group.user.displayName}
          avatarUrl={group.user.avatarUrl}
          className="size-7 shrink-0"
        />
        <span className="min-w-0 truncate text-sm font-medium">{group.user.displayName}</span>
      </button>
      <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
        {group.sources.map((source) => (
          <NodeChip key={source} tone={SOURCE_TONE[source]}>
            {ui.projects.source[source]}
            {source === 'observer' && group.observerKind
              ? ` · ${ui.projects.observerKind[group.observerKind]}`
              : null}
          </NodeChip>
        ))}
      </span>
      {removeLabel ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          aria-label={`${removeLabel}: ${group.user.displayName}`}
          title={removeLabel}
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </Button>
      ) : (
        <span className="w-6 shrink-0" aria-hidden />
      )}
    </li>
  );
}
