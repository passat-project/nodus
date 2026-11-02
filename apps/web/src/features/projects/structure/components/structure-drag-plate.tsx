import { Files } from 'lucide-react';
import type { NodeKind, ProjectNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { plural } from '../../../../shared/lib/format.js';
import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { NodeKindGlyph } from '../lib/node-kind-icon.js';
import type { DragPayload } from '../lib/use-structure-dnd.js';

/** Плашка DragOverlay дерева структуры: узел с ярлыком вида, название
 *  задачи или «N задач» (мультиселект). Стиль — карточка активного узла:
 *  hairline-рамка и кольцо, без тени (канон «плоско»). */
export function StructureDragPlate({
  active,
  nodes,
  kinds,
  tasks,
}: {
  active: DragPayload;
  nodes: ProjectNode[];
  kinds: NodeKind[];
  tasks: { id: string; title: string }[];
}) {
  let text: string;
  let kind: NodeKind | undefined;
  if (active.kind === 'node') {
    const node = nodes.find((n) => n.id === active.nodeId);
    text = node?.name ?? '';
    kind = node ? kinds.find((l) => l.id === node.kindId) : undefined;
  } else if (active.taskIds.length > 1) {
    text = `${active.taskIds.length} ${plural(active.taskIds.length, ui.structure.taskForms)}`;
  } else {
    text = tasks.find((t) => t.id === active.taskIds[0])?.title ?? '';
  }
  return (
    <div className="flex max-w-80 items-center gap-2 rounded-xl border border-input bg-card px-3 py-2 text-sm ring-1 ring-ring/25">
      {active.kind === 'node' ? (
        <span
          aria-hidden
          className={`flex size-6 shrink-0 items-center justify-center rounded border ${
            kind ? identityTone[kind.color].tile : 'border-border bg-accent/40'
          }`}
        >
          <NodeKindGlyph icon={kind?.icon ?? 'folder'} className="size-3.5" />
        </span>
      ) : active.taskIds.length > 1 ? (
        <Files className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      ) : null}
      <span className="truncate">{text}</span>
    </div>
  );
}
