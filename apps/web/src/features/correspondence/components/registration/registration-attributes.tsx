import type { CustomFieldDefinition, CustomFieldValues, LetterDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { CustomFieldEditor } from '../../../../shared/custom-fields/value-editor.js';

/**
 * Атрибуты области `letter` в форме регистрации (#431/#55): значения типа
 * письма правятся теми же редакторами, что в карточке; ошибка сервера
 * подсвечивает блок целиком (`customFields`).
 */
export function RegistrationAttributes({
  letter,
  definitions,
  values,
  onChange,
  invalid,
}: {
  letter: LetterDetail;
  definitions: readonly CustomFieldDefinition[];
  values: CustomFieldValues;
  onChange: (next: CustomFieldValues) => void;
  invalid?: string;
}) {
  return (
    <div data-reg-field="customFields" className="mt-2 flex flex-col gap-2">
      <NodeLabel label={ui.letters.form.attributes} count={definitions.length} />
      {definitions.map((definition) => (
        <div key={definition.id} className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{definition.name}</span>
          <CustomFieldEditor
            definition={definition}
            value={values[definition.id]}
            refs={letter.customFieldRefs}
            variant="form"
            onCommit={(next) => {
              const customFields = { ...values };
              if (next === null) delete customFields[definition.id];
              else customFields[definition.id] = next;
              onChange(customFields);
            }}
          />
        </div>
      ))}
      {invalid ? <p className="text-xs text-danger">{invalid}</p> : null}
    </div>
  );
}
