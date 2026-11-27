import type { ProcessType, StageColor, UpdateProcessTypeBody } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useUpdateProcessType } from '../../api/automation-api.js';
import { stageColorOrder, stageTone } from '../../../../shared/ui/board/stage-tone.js';
import { CommitTextarea } from '../../../../shared/ui/panel/commit-field.js';
import { PanelField } from '../../../../shared/ui/panel/panel-kit.js';
import { TypeIdentityFields } from '../../../../shared/ui/type-identity-fields.js';
import { PROCESS_TYPE_ICON_OPTIONS } from '../../../../shared/workflow/process-type-icon-options.js';

/**
 * Раздел «Основное» окна настроек типа задачи/письма (ревизия UI v3, #857):
 * название, значок, цвет и описание — подписи НАД полями, ширина полей
 * ограничена, горизонтального скролла нет. Сохраняется сразу: имя и описание —
 * по уходу фокуса, значок и цвет — выбором. У письма (каталог системный, #55)
 * и без права — только чтение.
 */
export function ProcessTypeMainSection({
  type,
  readOnly,
}: {
  type: ProcessType;
  readOnly: boolean;
}) {
  const update = useUpdateProcessType();
  const patch = (body: UpdateProcessTypeBody) => update.mutate({ id: type.id, body });
  return (
    <TypeIdentityFields
      labels={{
        name: ui.automation.fieldName,
        icon: ui.automation.fieldIcon,
        color: ui.automation.fieldColor,
      }}
      name={{ value: type.name, onChange: (name) => patch({ name }), disabled: readOnly }}
      icon={{
        value: type.icon,
        options: PROCESS_TYPE_ICON_OPTIONS,
        onChange: (icon) => type.icon !== icon && patch({ icon }),
        disabled: readOnly,
      }}
      color={{
        value: type.color,
        options: stageColorOrder as readonly StageColor[],
        swatchOf: (tone) => stageTone[tone].swatch,
        nameOf: (tone) => ui.tasks.stageColors[tone],
        onChange: (color) => type.color !== color && patch({ color }),
        disabled: readOnly,
      }}
    >
      <PanelField label={ui.automation.fieldDescription}>
        <CommitTextarea
          value={type.description}
          rows={3}
          maxLength={500}
          disabled={readOnly}
          aria-label={ui.automation.fieldDescription}
          className="w-full resize-none text-sm"
          onCommit={(description) => patch({ description })}
        />
      </PanelField>
    </TypeIdentityFields>
  );
}
