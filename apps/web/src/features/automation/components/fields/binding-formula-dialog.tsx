import type { CustomFieldDefinition, FormulaHostKind, FormulaNode } from '@nodus/contracts';

import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { TypeFormulaDialog } from '../../../../shared/custom-fields/formula/type-formula-dialog.js';

/** Диалог формулы привязки (#632): «Свои поля» — атрибуты того же места. */
export function BindingFormulaDialog({
  targetId,
  hostKind,
  definition,
  initial,
  onSave,
  onClose,
}: {
  targetId: string;
  hostKind: FormulaHostKind;
  definition: CustomFieldDefinition;
  initial: FormulaNode | null;
  onSave: (ast: FormulaNode | null) => void;
  onClose: () => void;
}) {
  const all = useCustomFieldDefinitions();
  const ownDefinitions = (all.data ?? []).filter((entry) =>
    hostKind === 'task' || hostKind === 'letter'
      ? entry.bindings.processTypeIds.includes(targetId)
      : hostKind === 'project'
        ? entry.bindings.projectTypeIds.includes(targetId)
        : entry.bindings.nodeKindIds.includes(targetId),
  );
  return (
    <TypeFormulaDialog
      open
      hostKind={hostKind}
      definition={definition}
      ownDefinitions={ownDefinitions}
      initial={initial}
      onSave={onSave}
      onClose={onClose}
    />
  );
}
