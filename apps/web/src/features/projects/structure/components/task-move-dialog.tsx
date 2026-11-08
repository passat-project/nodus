import { useState } from 'react';
import type { ProjectNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { plural } from '../../../../shared/lib/format.js';
import { useNumberHostAssignments } from '../../../../shared/custom-fields/queries.js';
import { nodeOptions } from '../lib/structure-tree.js';
import { TargetSelect } from './node-edit-dialog.js';

/** Перенос задач в узел / «Без узла» (меню строки задачи и мультиселекта):
 *  выбор цели, сама мутация — bulk set_node у вызывающего (с превью формул,
 *  `moveTasks` вкладки «Структура»). Триггер цели — общий `TargetSelect`
 *  (A9-6): длинное имя папки читается двумя строками и целиком в подсказке. */
export function TaskMoveDialog({
  count,
  nodes,
  taskId,
  onPick,
  onClose,
}: {
  count: number;
  nodes: ProjectNode[];
  /** Одна задача — подсказка «номер останется прежним» (#630, П5). */
  taskId?: string;
  onPick: (nodeId: string | null) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState('no-node');
  const items = [{ id: 'no-node', label: ui.structure.moveTasksNoNode }, ...nodeOptions(nodes)];
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{ui.structure.moveTasksTo}</DialogTitle>
          <DialogDescription>
            {`${count} ${plural(count, ui.structure.taskForms)}`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <NodeLabel label={ui.structure.moveTasksTo} />
          <TargetSelect value={target} onChange={setTarget} items={items} />
          {count === 1 && taskId ? <MoveNumberHint taskId={taskId} /> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button onClick={() => onPick(target === 'no-node' ? null : target)}>
            {ui.structure.move}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Подсказка «номер останется прежним» (#630, П5): номер выдан в счёте
 *  прежней папки и переносом не меняется. Хук зовётся только для одной
 *  задачи — окно пачки лишних запросов не делает. */
function MoveNumberHint({ taskId }: { taskId: string }) {
  const query = useNumberHostAssignments('task', taskId);
  const assignment = query.data?.items[0];
  if (!assignment) return null;
  const place =
    assignment.containers.length > 0
      ? assignment.containers.map((container) => container.name).join(' · ')
      : ui.customFields.dialog.counter.countsCompany;
  return (
    <p className="text-[11px] leading-4 text-muted-foreground">
      {ui.customFields.dialog.counter.assignment.moveKeeps
        .replace('{number}', assignment.display)
        .replace('{place}', place)}
    </p>
  );
}
