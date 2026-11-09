import type { ProcessTypeRef } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { ProcessTypeGlyph } from '../workflow/process-type-icon.js';
import { stageTone } from './board/stage-tone.js';

/**
 * Значок типа задачи (#670): глиф справочника типов в тоне цвета типа.
 * Стоит перед названием во всех списках задач — тип виден без открытия
 * карточки; полное имя — в title и aria-label (как значок типа на канбане,
 * #403). Это не колонка: шестерёнка вида его не скрывает.
 */
export function TaskTypeIcon({
  type,
  className,
}: {
  type: Pick<ProcessTypeRef, 'name' | 'icon' | 'color'>;
  className?: string;
}) {
  return (
    <span
      role="img"
      title={type.name}
      aria-label={type.name}
      className={cn('flex shrink-0 items-center', stageTone[type.color].glyph, className)}
    >
      <ProcessTypeGlyph icon={type.icon} className="size-3.5" />
    </span>
  );
}
