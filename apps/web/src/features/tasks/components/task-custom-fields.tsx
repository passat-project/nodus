import type { TaskDetail } from '@nodus/contracts';

import { CustomFieldsBlock } from '../../../shared/custom-fields/custom-fields-block.js';
import { customFieldValuesOf } from '../../../shared/custom-fields/queries.js';
import { useUpdateTaskCustomField } from '../api/task-custom-field-api.js';

/**
 * Блок «Атрибуты» карточки задачи (#431): значения из детали, правка по
 * месту оптимистично (I4). Настройка атрибутов — во вкладке «Атрибуты»
 * «Автоматизации», не из карточки. Старый API (:5173) значений не отдаёт —
 * `customFieldValuesOf` терпит, блок живёт пустым.
 */
export function TaskCustomFields({ task }: { task: TaskDetail }) {
  const update = useUpdateTaskCustomField(task.id);

  return (
    <CustomFieldsBlock
      module="task"
      targetId={task.type.id}
      values={customFieldValuesOf(task)}
      refs={task.customFieldRefs ?? []}
      canEdit={task.access.canEdit}
      onChange={(fieldId, value, refs) => update.mutate({ fieldId, value, refs })}
    />
  );
}
