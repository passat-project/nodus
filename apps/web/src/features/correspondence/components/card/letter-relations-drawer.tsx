import { memo, useState } from 'react';
import { ArrowLeft, Plus, Waypoints, X } from 'lucide-react';
import type { LetterRef, LetterRelationKind, LetterTreeNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@nodus/ui/components/empty';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { useLetterTree, useUnlinkLetterRelation } from '../../api/letters-relations.js';
import { findTreeNode, flattenLetterTree, treeNodeCount } from '../../lib/letter-tree.js';
import { LetterRelationDialog } from './letter-relation-dialog.js';
import {
  LetterRelationNode,
  LetterTreeEdges,
  TREE_ROW_H,
  nodeNumber,
} from './letter-relation-node.js';
import { LetterUnlinkDialog } from './letter-unlink-dialog.js';

/** Источник окна связи: текущее письмо или узел при «Заменить». */
interface RelationDialogState {
  source: LetterTreeNode;
  initialKind: LetterRelationKind;
  existing: Partial<Record<LetterRelationKind, LetterRef>>;
}

/** Связи письма с родителями в дереве — по видам (что именно заменится).
 *  Письмо с двумя связями стоит в дереве дважды — собираем оба вхождения. */
function existingLinks(
  node: LetterTreeNode,
  sourceId: string,
  found: Partial<Record<LetterRelationKind, LetterRef>> = {},
): Partial<Record<LetterRelationKind, LetterRef>> {
  for (const child of node.children) {
    if (child.id === sourceId && child.relationKind) {
      found[child.relationKind] = {
        id: node.id,
        regNumber: nodeNumber(node),
        subject: node.subject,
      };
    }
    existingLinks(child, sourceId, found);
  }
  return found;
}

/** Родитель узла по связи `relationId` (для текста подтверждения снятия). */
function parentByRelation(node: LetterTreeNode, relationId: string): LetterTreeNode | null {
  for (const child of node.children) {
    if (child.relationId === relationId) return node;
    const deeper = parentByRelation(child, relationId);
    if (deeper) return deeper;
  }
  return null;
}

const skeletonRows = [0, 1, 1, 2] as const;

/**
 * Панель «Связи» — «ёлочка» карточки письма (#461, В1/В5/В6): дерево-граф
 * цепочки «ответ на» и писем-матрёшек «вложено в» в грамматике контура
 * Nodus (порты, ортогональные рёбра с локтями — как дерево журнала задач).
 * Клик по узлу — замена содержимого карточки (стек не растёт, ADR-0009),
 * «←» — шаг назад по переходам сессии. Связи правит только канцелярия
 * (`canManage`): «Добавить связь» в баре панели (одна горизонталь с баром
 * действий карточки), «Заменить»/«Снять» — в меню узла; снятие — с
 * подтверждением. Вложения-файлы в дерево не входят (спека) — только письма.
 */
export const LetterRelationsDrawer = memo(function LetterRelationsDrawer({
  rootId,
  currentId,
  canManage,
  canBack,
  onBack,
  onNavigate,
  onClose,
}: {
  /** Стартовое письмо сессии навигации — корень дерева неизменен. */
  rootId: string;
  /** Просматриваемое письмо — подсветка узла. */
  currentId: string;
  canManage: boolean;
  canBack: boolean;
  onBack: () => void;
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const { data: tree, isLoading } = useLetterTree(rootId);
  const unlink = useUnlinkLetterRelation(rootId);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<RelationDialogState | null>(null);
  const [unlinking, setUnlinking] = useState<LetterTreeNode | null>(null);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const openDialog = (source: LetterTreeNode, initialKind?: LetterRelationKind) => {
    if (!tree) return;
    const existing = existingLinks(tree.root, source.id);
    setDialog({
      source,
      initialKind:
        initialKind ?? (existing.reply_to && !existing.nested_in ? 'nested_in' : 'reply_to'),
      existing,
    });
  };

  const current = tree ? findTreeNode(tree.root, currentId) : null;
  const rows = tree ? flattenLetterTree(tree.root, collapsed) : [];
  const empty = tree ? tree.root.children.length === 0 : false;
  const unlinkParent =
    tree && unlinking?.relationId ? parentByRelation(tree.root, unlinking.relationId) : null;

  return (
    <div className="flex h-full w-full min-w-[18.75rem] flex-col border-r border-border bg-card">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-2 pl-1.5">
        <button
          type="button"
          onClick={onBack}
          disabled={!canBack}
          aria-label={ui.letters.relations.back}
          title={ui.letters.relations.back}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
        </button>
        <span className="min-w-0 truncate px-1 text-body-xs font-medium">
          {ui.letters.relations.title}
        </span>
        {tree && !empty ? (
          <span
            className="font-mono text-label-sm text-muted-foreground tabular-nums"
            title={ui.letters.relations.count(treeNodeCount(tree.root))}
          >
            {treeNodeCount(tree.root)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label={ui.common.close}
          title={ui.common.close}
          className="ml-auto shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {isLoading ? (
          <div className="flex flex-col">
            {skeletonRows.map((depth, index) => (
              <div
                key={index}
                className="flex flex-col justify-center gap-1.5"
                style={{ height: TREE_ROW_H, paddingLeft: 22 + depth * 20 }}
              >
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-2.5 w-2/5" />
              </div>
            ))}
          </div>
        ) : !tree ? (
          <p className="p-2 text-xs text-muted-foreground">{ui.letters.card.notFound}</p>
        ) : empty ? (
          <div className="flex h-full items-center justify-center">
            <Empty className="border-0 p-4">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Waypoints strokeWidth={1.75} />
                </EmptyMedia>
                <EmptyTitle>{ui.letters.relations.empty}</EmptyTitle>
                <EmptyDescription>{ui.letters.relations.emptyHint}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <>
            <div className="relative" style={{ height: rows.length * TREE_ROW_H }}>
              {rows.map((row, index) => (
                <LetterRelationNode
                  key={row.key}
                  row={row}
                  currentId={currentId}
                  collapsed={collapsed.has(row.key)}
                  showKind={rows[index - 1]?.key !== row.parentKey}
                  canManage={canManage}
                  onToggle={toggle}
                  onNavigate={onNavigate}
                  onAdd={(node) => openDialog(node)}
                  onReplace={(node) => openDialog(node, node.relationKind ?? undefined)}
                  onUnlink={setUnlinking}
                />
              ))}
              <LetterTreeEdges rows={rows} currentId={currentId} />
            </div>
            {tree.truncated ? (
              <p className="mt-2 px-2 text-xs text-muted-foreground">
                {ui.letters.relations.truncated}
              </p>
            ) : null}
          </>
        )}
      </div>

      {canManage ? (
        // Бар панели — продолжение бара действий карточки: та же высота h-16
        // и горизонталь границы, кнопка — калибр вторичных кнопок бара
        // (h-8, иконка 16, тихая подложка на ховере), по центру высоты.
        <div className="flex h-16 shrink-0 items-center border-t border-border px-3">
          <button
            type="button"
            onClick={() => current && openDialog(current)}
            disabled={!current}
            className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Plus className="size-4 shrink-0" strokeWidth={1.75} />
            {ui.letters.relations.add}
          </button>
        </div>
      ) : null}

      {dialog ? (
        <LetterRelationDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          rootId={rootId}
          source={dialog.source}
          initialKind={dialog.initialKind}
          existing={dialog.existing}
        />
      ) : null}
      <LetterUnlinkDialog
        node={unlinking}
        parent={unlinkParent}
        onCancel={() => setUnlinking(null)}
        onConfirm={() => {
          if (unlinking?.relationId) {
            unlink.mutate({ sourceId: unlinking.id, relationId: unlinking.relationId });
          }
          setUnlinking(null);
        }}
      />
    </div>
  );
});
