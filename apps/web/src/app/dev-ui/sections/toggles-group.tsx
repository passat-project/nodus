import { devUiStrings } from '@nodus/contracts';
import { Checkbox } from '@nodus/ui/components/checkbox';
import { Label } from '@nodus/ui/components/label';
import { Switch } from '@nodus/ui/components/switch';
import { TriangleAlert } from 'lucide-react';

import { DevField, DevGroup } from '../dev-section.js';

/**
 * Ф4: переключатели одного калибра (#432). Связки «контрол — подпись» собраны
 * через Label с htmlFor: клик по подписи переключает, фокус ходит с клавиатуры.
 * Radio в `packages/ui` нет — галерея честно показывает пробел, а не рисует
 * самодельный примитив (новые примитивы вне скоупа #257).
 */
export function TogglesGroup() {
  return (
    <DevGroup
      title={devUiStrings.controls.toggles}
      hint={devUiStrings.controls.togglesHint}
      caption={devUiStrings.controls.captionToggles}
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DevField label="Checkbox · checked">
          <div className="flex h-8 items-center gap-2">
            <Checkbox id="dev-checkbox-on" defaultChecked />
            <Label htmlFor="dev-checkbox-on">{devUiStrings.controls.checkbox}</Label>
          </div>
        </DevField>
        <DevField label="Checkbox · unchecked">
          <div className="flex h-8 items-center gap-2">
            <Checkbox id="dev-checkbox-off" />
            <Label htmlFor="dev-checkbox-off">{devUiStrings.controls.checkbox}</Label>
          </div>
        </DevField>
        <DevField label="Checkbox · disabled">
          <div className="flex h-8 items-center gap-2">
            <Checkbox id="dev-checkbox-disabled" disabled />
            <Label htmlFor="dev-checkbox-disabled">{devUiStrings.controls.checkboxDisabled}</Label>
          </div>
        </DevField>
        <DevField label={devUiStrings.controls.radioGapLabel}>
          <div className="flex h-8 items-center gap-2 text-label-sm text-muted-foreground">
            <TriangleAlert className="size-3.5 shrink-0 text-warning" strokeWidth={1.75} />
            <span>{devUiStrings.controls.radioGap}</span>
          </div>
        </DevField>
        <DevField label="Switch · checked">
          <div className="flex h-8 items-center gap-2">
            <Switch id="dev-switch-on" defaultChecked />
            <Label htmlFor="dev-switch-on">{devUiStrings.controls.switchOn}</Label>
          </div>
        </DevField>
        <DevField label="Switch · unchecked">
          <div className="flex h-8 items-center gap-2">
            <Switch id="dev-switch-off" />
            <Label htmlFor="dev-switch-off">{devUiStrings.controls.switchOff}</Label>
          </div>
        </DevField>
        <DevField label="Switch · disabled">
          <div className="flex h-8 items-center gap-2">
            <Switch id="dev-switch-disabled" disabled />
            <Label htmlFor="dev-switch-disabled">{devUiStrings.controls.switchOff}</Label>
          </div>
        </DevField>
      </div>
    </DevGroup>
  );
}
