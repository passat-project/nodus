import type { LetterDetail } from '@nodus/contracts';

import { CustomFieldsBlock } from '../../../../shared/custom-fields/custom-fields-block.js';
import { mergedRefs, patchedValues } from '../../../../shared/custom-fields/value-patch.js';
import { useUpdateLetter } from '../../api/letters-mutations.js';

/** Атрибуты типа письма (#55, ADR-0029; #631 — модуль `letter`, привязка
 *  к типу) — тот же блок, что у задачи; правка по месту у `access.canEdit`,
 *  оптимистично: значение и ссылка выбора — в карточке до ответа сервера. */
export function LetterAttributes({ letter }: { letter: LetterDetail }) {
  const update = useUpdateLetter(letter.id);
  return (
    <CustomFieldsBlock
      module="letter"
      targetId={letter.typeId}
      values={letter.customFields}
      refs={letter.customFieldRefs}
      canEdit={letter.access.canEdit}
      host={{ kind: 'letter', id: letter.id }}
      formulas={letter.customFieldFormulas}
      onChange={(fieldId, value, refs) =>
        update.mutate({
          body: { customFields: { [fieldId]: value } },
          patch: {
            customFields: patchedValues(letter.customFields, fieldId, value),
            customFieldRefs: mergedRefs(letter.customFieldRefs, refs),
          },
        })
      }
    />
  );
}
