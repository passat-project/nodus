import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Link2Off,
  Lock,
  Mail,
  MailOpen,
} from 'lucide-react';
import type { LetterTreeNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Строка дерева «ёлочки» (#461, Р2): шеврон раскрытия вложенных, иконка
 * направления, замок конфиденциального, номер; клик — переход в карточке.
 * Меню узла (канцелярия) — «Заменить»/«Снять» связь с родителем.
 */
export function LetterRelationNode({
  node,
  depth,
  currentId,
  collapsed,
  canManage,
  onToggle,
  onNavigate,
  onReplace,
  onUnlink,
}: {
  node: LetterTreeNode;
  depth: number;
  currentId: string;
  collapsed: ReadonlySet<string>;
  canManage: boolean;
  onToggle: (id: string) => void;
  onNavigate: (id: string) => void;
  onReplace: (node: LetterTreeNode) => void;
  onUnlink: (node: LetterTreeNode) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const isCurrent = node.id === currentId;
  const label = node.subject ?? node.regNumber ?? '';
  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1.5 rounded-md py-1 pr-1 pl-1.5 transition-colors',
          isCurrent ? 'bg-accent text-foreground' : 'text-secondary-foreground hover:bg-accent/50',
        )}
        style={{ marginLeft: depth * 14 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
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
          className="shrink-0 text-muted-foreground"
          title={
            node.direction === 'incoming' ? ui.letters.tabs.incoming : ui.letters.tabs.outgoing
          }
        >
          {node.direction === 'incoming' ? (
            <MailOpen className="size-3.5" strokeWidth={1.75} />
          ) : (
            <Mail className="size-3.5" strokeWidth={1.75} />
          )}
        </span>
        {node.confidential ? (
          <span
            aria-hidden
            className="shrink-0 text-muted-foreground"
            title={ui.letters.confidential.badge}
          >
            <Lock className="size-3" strokeWidth={1.75} />
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (node.id !== currentId) onNavigate(node.id);
          }}
          className="min-w-0 flex-1 truncate text-left text-sm"
          title={node.subject ?? ui.letters.noSubject}
        >
          {node.subject ?? ui.letters.noSubject}
        </button>
        <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
          {node.regNumber ?? ui.letters.noNumber}
        </span>
        {canManage && node.relationId ? (
          <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              onClick={() => onReplace(node)}
              aria-label={`${ui.letters.relations.replace}: ${label}`}
              title={ui.letters.relations.replace}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ArrowLeftRight className="size-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => onUnlink(node)}
              aria-label={`${ui.letters.relations.unlink}: ${label}`}
              title={ui.letters.relations.unlink}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Link2Off className="size-3.5" strokeWidth={1.75} />
            </button>
          </span>
        ) : null}
      </div>
      {hasChildren && !isCollapsed
        ? node.children.map((child) => (
            <LetterRelationNode
              key={child.id}
              node={child}
              depth={depth + 1}
              currentId={currentId}
              collapsed={collapsed}
              canManage={canManage}
              onToggle={onToggle}
              onNavigate={onNavigate}
              onReplace={onReplace}
              onUnlink={onUnlink}
            />
          ))
        : null}
    </div>
  );
}
