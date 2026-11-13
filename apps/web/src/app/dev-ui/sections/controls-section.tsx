import { devUiStrings } from '@nodus/contracts';

import { DevSection } from '../dev-section.js';
import { ButtonsGroup } from './buttons-group.js';
import { InputsGroup } from './inputs-group.js';
import { TogglesGroup } from './toggles-group.js';

/**
 * Ф4: контролы во всех состояниях. Секция — только композиция групп (I5:
 * каждый файл про одну ответственность, страница остаётся читаемой).
 */
export function ControlsSection() {
  return (
    <DevSection
      id="dev-controls"
      label={devUiStrings.sections.controls}
      hint={devUiStrings.controls.hint}
    >
      <div className="flex flex-col gap-4">
        <ButtonsGroup />
        <InputsGroup />
        <TogglesGroup />
      </div>
    </DevSection>
  );
}
