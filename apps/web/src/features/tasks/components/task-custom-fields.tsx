import { useState } from 'react';
import type { CustomFieldRef, CustomFieldValue, TaskDetail } from '@nodus/contracts';
import { customFieldKey } from '@nodus/contracts';

import { CustomFieldsBlock } from '../../../shared/custom-fields/custom-fields-block.js';
import { customFieldValuesOf } from '../../../shared/custom-fields/queries.js';
import { LockReasonDialog } from '../../../shared/forms/field-lock-ui.js';
import { useUpdateTaskCustomField } from '../api/task-custom-field-api.js';

interface PendingEdit {
  fieldId: string;
  value: CustomFieldValue | null;
  refs?: readonly CustomFieldRef[];
}

/**
 * Блок «Атрибуты» карточки задачи (#431): значения из детали, правка по
 * месту оптимистично (I4). Закреплённое поле (#496) — значок замка у метки;
 * без `canEdit` только чтение, владельцу — окно причины и `lockReason`.
 */
export function TaskCustomFields({ task }: { task: TaskDetail }) {
  const update = useUpdateTaskCustomField(task.id);
  const [pending, setPending] = useState<PendingEdit | null>(null);

  const commit = (edit: PendingEdit, reason?: string) =>
    update.mutate({
      fieldId: edit.fieldId,
      value: edit.value,
      ...(edit.refs ? { refs: edit.refs } : {}),
      ...(reason ? { lockReason: reason } : {}),
    });

  return (
    <>
      <CustomFieldsBlock
        module="task"
        targetId={task.type.id}
        values={customFieldValuesOf(task)}
        refs={task.customFieldRefs ?? []}
        canEdit={task.access.canEdit}
        locks={task.fieldLocks}
        onChange={(fieldId, value, refs) => {
          const lock = task.fieldLocks.find((entry) => entry.key === customFieldKey(fieldId));
          const edit: PendingEdit = { fieldId, value, ...(refs ? { refs } : {}) };
          if (lock?.canEdit) {
            setPending(edit);
            return;
          }
          commit(edit);
        }}
        host={{ kind: 'task', id: task.id }}
        hostContext={{
          parentId: task.parentId,
          projectId: task.project?.id ?? null,
          nodeId: task.nodeId,
        }}
        formulas={task.customFieldFormulas}
      />
      <LockReasonDialog
        open={pending !== null}
        onCancel={() => setPending(null)}
        onConfirm={(reason) => {
          if (pending) commit(pending, reason);
          setPending(null);
        }}
      />
    </>
  );
}
