import { Trash2 } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { BulkIsland, bulkActionClass } from '../../../../shared/views/bulk-island.js';

/**
 * Островок массовых действий реестра атрибутов: каркас — общий
 * `shared/views/bulk-island`, здесь только команды. «Удалить» — всегда
 * (окно последствий честно перечислит, что сотрётся, Р8). Тестовый мусор
 * чистится пачкой — ради этого островок и есть.
 */
export function FieldBulkIsland({
  count,
  visible,
  onDelete,
  onClear,
}: {
  count: number;
  visible: boolean;
  onDelete: () => void;
  onClear: () => void;
}) {
  const tabIndex = visible ? 0 : -1;
  return (
    <BulkIsland
      visible={visible}
      count={count}
      ariaLabel={ui.customFields.page.title}
      onClear={onClear}
    >
      <button type="button" className={bulkActionClass} tabIndex={tabIndex} onClick={onDelete}>
        <Trash2 className="size-4" strokeWidth={1.75} />
        {ui.customFields.menu.delete}
      </button>
    </BulkIsland>
  );
}
