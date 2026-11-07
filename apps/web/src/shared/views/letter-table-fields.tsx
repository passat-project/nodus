import { useMemo } from 'react';
import type { LetterBox, LetterListItem } from '@nodus/contracts';

import { useCustomFieldDefinitions } from '../custom-fields/queries.js';
import type { DataTableField } from './data-table.js';
import { makeLetterTableFields } from './letter-table-system-fields.js';

export { ResponseDeadline, isResponseOverdue, theirReference } from './letter-table-cells.js';
export { makeLetterTableFields } from './letter-table-system-fields.js';

export function useLetterTableFields({
  counterpartyVisible = true,
  box,
}: { counterpartyVisible?: boolean; box?: LetterBox } = {}): DataTableField<LetterListItem>[] {
  const { data } = useCustomFieldDefinitions('letter');
  return useMemo(
    () => makeLetterTableFields({ counterpartyVisible, box, definitions: data }),
    [counterpartyVisible, box, data],
  );
}
