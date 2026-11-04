import { memo, useState } from 'react';
import { ArrowLeft, Plus, X } from 'lucide-react';
import type { LetterRef, LetterRelationKind, LetterTreeNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { useLetterTree, useUnlinkLetterRelation } from '../../api/letters-relations.js';
import { LetterRelationDialog } from './letter-relation-dialog.js';
import { LetterRelationNode } from './letter-relation-node.js';

/** Источник окна связи: текущее письмо или узел при «Заменить». */
interface RelationDialogState {
  sourceId: string;
  initialKind: LetterRelationKind;
  existing: Partial<Record<LetterRelationKind, LetterRef>>;
  excludeId: string;
}

/** Родитель узла в дереве (для «Заменить»: что именно заменится). */
function parentOf(
  node: LetterTreeNode,
  id: string,
): { parent: LetterTreeNode; child: LetterTreeNode } | null {
  for (const child of node.children) {
    if (child.id === id) return { parent: node, child };
    const deeper = parentOf(child, id);
    if (deeper) return deeper;
  }
  return null;
}

function existingLinks(
  tree: LetterTreeNode,
  sourceId: string,
): Partial<Record<LetterRelationKind, LetterRef>> {
  const found = parentOf(tree, sourceId);
  if (!found?.child.relationKind) return {};
  return {
    [found.child.relationKind]: {
      id: found.parent.id,
      regNumber: found.parent.regNumber,
      subject: found.parent.subject,
    },
  };
}

/**
 * Панель «Связи» — «ёлочка» карточки письма (#461, В1/В6): дерево цепочки
 * «ответ на» и вложенных писем-матрёшек, как навигатор подзадач задачи.
 * Клик по узлу — замена содержимого карточки (стек не растёт, ADR-0009),
 * «←» — шаг назад по переходам сессии. Связи правит только канцелярия
 * (`canManage`): «Добавить» в подвале, «Заменить»/«Снять» в меню узла.
 * Вложения-файлы в дерево не входят (спека) — только письма.
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
  /** Просматриваемое письмо — подсветка строки. */
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

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openAdd = () => {
    if (!tree) return;
    const existing = existingLinks(tree.root, currentId);
    setDialog({
      sourceId: currentId,
      initialKind: existing.reply_to ? 'nested_in' : 'reply_to',
      existing,
      excludeId: currentId,
    });
  };

  const openReplace = (node: LetterTreeNode) => {
    if (!tree || !node.relationKind) return;
    setDialog({
      sourceId: node.id,
      initialKind: node.relationKind,
      existing: existingLinks(tree.root, node.id),
      excludeId: node.id,
    });
  };

  const empty = tree ? tree.root.children.length === 0 && tree.root.id === currentId : false;

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
        <span className="min-w-0 flex-1 truncate text-body-xs font-medium">
          {ui.letters.relations.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={ui.common.close}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-1">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-4/5" />
            <Skeleton className="h-6 w-3/5" />
          </div>
        ) : !tree ? (
          <p className="p-1 text-xs text-muted-foreground">{ui.letters.card.notFound}</p>
        ) : empty ? (
          <div className="flex flex-col gap-1 p-1">
            <p className="text-sm text-muted-foreground">{ui.letters.relations.empty}</p>
            <p className="text-xs text-muted-foreground">{ui.letters.relations.emptyHint}</p>
          </div>
        ) : (
          <>
            <LetterRelationNode
              node={tree.root}
              depth={0}
              currentId={currentId}
              collapsed={collapsed}
              canManage={canManage}
              onToggle={toggle}
              onNavigate={onNavigate}
              onReplace={openReplace}
              onUnlink={(node) =>
                node.relationId && unlink.mutate({ sourceId: node.id, relationId: node.relationId })
              }
            />
            {tree.truncated ? (
              <p className="mt-2 px-1.5 text-xs text-muted-foreground">
                {ui.letters.relations.truncated}
              </p>
            ) : null}
          </>
        )}
      </div>

      {canManage ? (
        <div className="shrink-0 border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={openAdd}
            disabled={!tree}
            className="w-full justify-start text-muted-foreground"
          >
            <Plus data-icon="inline-start" />
            {ui.letters.relations.add}
          </Button>
        </div>
      ) : null}

      {dialog ? (
        <LetterRelationDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          rootId={rootId}
          sourceId={dialog.sourceId}
          initialKind={dialog.initialKind}
          existing={dialog.existing}
          excludeId={dialog.excludeId}
        />
      ) : null}
    </div>
  );
});
