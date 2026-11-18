import type { CustomFieldDefinition } from '@nodus/contracts';
import { customFieldKey, isCreationSlot, isFieldFormSlot } from '@nodus/contracts';

import { demoNodeKinds } from '../../mocks/data/project-nodes.js';
import { demoProjectTypes } from '../../mocks/data/projects.js';
import { mockTypes } from '../../mocks/data/process-types-store.js';
import { mockWorkflows } from '../../mocks/data/workflows-store.js';

/** Слоты форм мест в мок-мире (#646): инвариант «слот = привязка» работает
 *  в обе стороны — снятие привязки/удаление атрибута чистит слот формы того
 *  места, где он стоял. Формы создания маршрутов живут в документе
 *  workflow, формы типов проектов и видов папок — в самих справочниках. */

/** Снять слот `cf.<id>` из форм создания типов процессов (#646): снятие
 *  привязки к типу не должно оставлять required-слот, который нельзя
 *  заполнить (`not_in_type`). `keep` — типы, у которых осталась привязка. */
export function removeCreationFormSlot(
  fieldId: string,
  keep: ReadonlySet<string> = new Set(),
): void {
  const key = customFieldKey(fieldId);
  for (const type of mockTypes) {
    if (keep.has(type.id)) continue;
    const creation = mockWorkflows.get(type.workflowId)?.document.creation;
    if (!creation) continue;
    const fields = creation.fields.filter((entry) => !isCreationSlot(entry) || entry.key !== key);
    if (fields.length === creation.fields.length) continue;
    creation.fields = fields;
  }
}

/** Снять слот атрибута из формы места (тип проекта / вид папки): unbind
 *  чистит форму так же, как сервер. */
export function removeFormSlot(kind: string, targetId: string, fieldId: string): void {
  if (kind === 'project-type') {
    const type = demoProjectTypes.find((entry) => entry.id === targetId);
    if (type) {
      type.form = {
        ...type.form,
        fields: type.form.fields.filter(
          (slot) => !isFieldFormSlot(slot) || slot.fieldId !== fieldId,
        ),
      };
    }
    return;
  }
  if (kind === 'node-kind') {
    const nodeKind = demoNodeKinds.find((entry) => entry.id === targetId);
    if (nodeKind) {
      nodeKind.form = {
        ...nodeKind.form,
        fields: nodeKind.form.fields.filter(
          (slot) => !isFieldFormSlot(slot) || slot.fieldId !== fieldId,
        ),
      };
    }
  }
}

/** Замена набора привязок (#646): снятые цели чистят слоты форм мест —
 *  типов проектов, видов папок и форм создания маршрутов. */
export function applyBindingsChange(
  definition: CustomFieldDefinition,
  before: CustomFieldDefinition['bindings'],
  next: CustomFieldDefinition['bindings'],
): void {
  for (const targetId of before.projectTypeIds) {
    if (!next.projectTypeIds.includes(targetId)) {
      removeFormSlot('project-type', targetId, definition.id);
    }
  }
  for (const targetId of before.nodeKindIds) {
    if (!next.nodeKindIds.includes(targetId)) {
      removeFormSlot('node-kind', targetId, definition.id);
    }
  }
  if (before.processTypeIds.some((id) => !next.processTypeIds.includes(id))) {
    removeCreationFormSlot(definition.id, new Set(next.processTypeIds));
  }
}

/** Снятие одной привязки: слот соответствующего места, а у типа процесса —
 *  форма создания маршрута (оставшиеся привязки слот сохраняют). */
export function removeUnboundSlot(
  kind: string,
  targetId: string,
  fieldId: string,
  remainingProcessTypeIds: readonly string[],
): void {
  if (kind === 'process-type') removeCreationFormSlot(fieldId, new Set(remainingProcessTypeIds));
  else removeFormSlot(kind, targetId, fieldId);
}
