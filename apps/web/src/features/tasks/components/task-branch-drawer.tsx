import { memo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import type { TaskBranchNode, TaskRelation } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { Input } from '@nodus/ui/components/input';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';

import { useTaskBranch, useTaskRelations } from '../api/tasks-api.js';
import { stageTone } from '../../../shared/ui/board/stage-tone.js';
import { useQuickCreate } from '../../../shared/tasks/quick-create.js';

type BranchTab = 'subtasks' | 'relations';

/** Панель-навигатор — левый «центр навигации» карточки задачи (ClickUp +
 *  вердикт владельца 2026-09-11). Вкладка «Подзадачи» — дерево от корня
 *  СТАРТОВОЙ задачи сессии (rootId неизменен: карта стабильна, не прыгает
 *  при переходах), вкладка «Связи» — связи просматриваемой задачи (поле
 *  «Отношения», заготовка под зависимости Ганта #39).
 *  Клик по строке — ЗАМЕНА содержимого карточки через onNavigate (стек
 *  карточек НЕ растёт, панель не закрывается, один Escape закрывает всю
 *  сессию); «←» в шапке — шаг назад по переходам. Подсветка —
 *  просматриваемая задача. Быстрое создание подзадачи — внизу (к текущей)
 *  или по «+» на строке (к этой строке). */
export const TaskBranchDrawer = memo(function TaskBranchDrawer({
  rootId,
  currentId,
  canBack,
  onBack,
  onNavigate,
  onClose,
}: {
  /** Корень сессии навигации (стартовая задача карточки) — дерево от него. */
  rootId: string;
  /** Просматриваемая задача — подсветка строки и источник вкладки «Связи». */
  currentId: string;
  canBack: boolean;
  onBack: () => void;
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const { data: branch } = useTaskBranch(rootId);
  const quick = useQuickCreate();
  const [tab, setTab] = useState<BranchTab>('subtasks');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  function openTask(id: string) {
    if (id === currentId) return;
    onNavigate(id);
  }

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submitSubtask(parentId: string) {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    setAddingTo(null);
    // #432 (Р10): строка подзадачи — быстрый вход единого окна создания.
    quick.run({ title, parentId });
  }

  function renderNode(node: TaskBranchNode, depth: number): React.ReactNode {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);
    const isCurrent = node.id === currentId;
    return (
      <div key={node.id}>
        <div
          className={cn(
            'group flex items-center gap-1.5 rounded-md py-1 pr-1 pl-1.5 transition-colors',
            isCurrent
              ? 'bg-accent text-foreground'
              : 'text-secondary-foreground hover:bg-accent/50',
          )}
          style={{ marginLeft: depth * 14 }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(node.id)}
              aria-label={isCollapsed ? ui.tasks.expandBranch : ui.tasks.collapseBranch}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              {isCollapsed ? (
                <ChevronRight className="size-3.5" strokeWidth={1.75} />
              ) : (
                <ChevronDown className="size-3.5" strokeWidth={1.75} />
              )}
            </button>
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          <span
            aria-hidden
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              stageTone[node.stageColor ?? 'neutral'].dot,
            )}
            title={node.stageName ?? undefined}
          />
          {node.hidden ? (
            // Задача зрителю не видна (#343): только номер, без перехода.
            <span
              className="min-w-0 flex-1 truncate text-left text-sm text-muted-foreground"
              title={ui.tasks.branchHiddenNode}
            >
              {node.title}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => openTask(node.id)}
              className="min-w-0 flex-1 truncate text-left text-sm"
              title={node.title}
            >
              {node.title}
            </button>
          )}
          <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
            {node.number}
          </span>
          {node.hidden ? (
            // Пустышка той же ширины, что «+» (p-0.5 + size-3.5): колонка
            // номеров не съезжает у скрытого узла (приёмка #343).
            <span aria-hidden className="shrink-0 p-0.5">
              <span className="block size-3.5" />
            </span>
          ) : (
            <button
              type="button"
              aria-label={ui.tasks.subtasks}
              onClick={() => {
                setAddingTo(node.id);
                setDraft('');
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
            </button>
          )}
        </div>
        {addingTo === node.id ? (
          <InlineAdd
            depth={depth + 1}
            draft={draft}
            onDraft={setDraft}
            onSubmit={() => submitSubtask(node.id)}
            onCancel={() => setAddingTo(null)}
          />
        ) : null}
        {hasChildren && !isCollapsed
          ? node.children.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  }

  const tabs: { id: BranchTab; label: string }[] = [
    { id: 'subtasks', label: ui.tasks.subtasks },
    { id: 'relations', label: ui.tasks.branchRelations },
  ];

  return (
    // Ширина — колонки карточки (#365); min-w: анимация обрезает, не перекладывает.
    <div className="flex h-full w-full min-w-[18.75rem] flex-col border-r border-border bg-card">
      {/* Шапка: «←» — шаг назад по переходам сессии; вкладки; закрытие */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-2 pl-1.5">
        <button
          type="button"
          onClick={onBack}
          disabled={!canBack}
          aria-label={ui.tasks.navBack}
          title={ui.tasks.navBack}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
        </button>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id}
            className={cn(
              'h-10 rounded-none border-b-2 px-2.5 text-body-xs font-medium transition-colors',
              tab === t.id
                ? 'border-port text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground/80',
            )}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          aria-label={ui.common.close}
          className="ml-auto shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>
      </div>
      {tab === 'subtasks' ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {branch ? (
              renderNode(branch.root, 0)
            ) : (
              <div className="flex flex-col gap-2 p-1">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-4/5" />
                <Skeleton className="h-6 w-3/5" />
              </div>
            )}
          </div>
        </>
      ) : (
        <RelationsTab currentId={currentId} onNavigate={onNavigate} />
      )}
    </div>
  );
});

/** Вкладка «Связи»: связи просматриваемой задачи (поле «Отношения»).
 *  Клик — переход заменой (та же карточка). Пока данных нет — Empty. */
function RelationsTab({
  currentId,
  onNavigate,
}: {
  currentId: string;
  onNavigate: (id: string) => void;
}) {
  const { data, isLoading } = useTaskRelations(currentId);
  const items = data?.items ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {isLoading ? (
        <div className="flex flex-col gap-2 p-1">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-4/5" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <Empty>
            <EmptyTitle>{ui.tasks.relationsEmpty}</EmptyTitle>
          </Empty>
        </div>
      ) : (
        items.map((relation: TaskRelation) => (
          <button
            key={relation.id}
            type="button"
            onClick={() => onNavigate(relation.task.id)}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-secondary-foreground transition-colors hover:bg-accent/50"
          >
            <span className="min-w-0 flex-1 truncate">{relation.task.title}</span>
            <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
              {relation.task.number}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

function InlineAdd({
  depth,
  draft,
  onDraft,
  onSubmit,
  onCancel,
}: {
  depth: number;
  draft: string;
  onDraft: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ marginLeft: depth * 14 }} className="py-1 pl-1.5">
      <Input
        autoFocus
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
          if (e.key === 'Escape') {
            // Инлайн-редактор гасит Esc сам: иначе клавиша всплывает до
            // карточки/слайдера и закрывает её вместе с несохранённым вводом.
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        onBlur={onCancel}
        placeholder={ui.tasks.subtaskPlaceholder}
        className="h-7 text-sm"
      />
    </div>
  );
}
