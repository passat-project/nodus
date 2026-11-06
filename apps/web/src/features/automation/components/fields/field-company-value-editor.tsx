import type { CustomFieldDefinition, CustomFieldRef, CustomFieldValue } from '@nodus/contracts';

import { CustomFieldEditor } from '../../../../shared/custom-fields/value-editor.js';

/** Инлайн-редактор значения глобальной (Р7): коммит уходит мутацией реестра
 *  (useSetCompanyValue в fields-tab), оптимистичный показ — из кэша.
 *  Выбранная ссылка едет вместе со значением: иначе до ответа сервера
 *  свежая ссылка показывает «Запись недоступна» (#646). */
export function CompanyValueEditor({
  definition,
  canManage,
  onCommit,
}: {
  definition: CustomFieldDefinition;
  canManage: boolean;
  onCommit: (
    definition: CustomFieldDefinition,
    value: CustomFieldValue | null,
    refs?: readonly CustomFieldRef[],
  ) => void;
}) {
  return (
    <span
      className="flex min-w-0 items-center"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <CustomFieldEditor
        definition={definition}
        value={definition.companyValue ?? undefined}
        refs={definition.companyRefs ?? []}
        disabled={!canManage}
        variant="inline"
        onCommit={(value, picked) => onCommit(definition, value, picked)}
      />
    </span>
  );
}
