import { devUiStrings } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@nodus/ui/components/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Search } from 'lucide-react';

import { DevField, DevGroup } from '../dev-section.js';

/**
 * Ф4: поля ввода и селект. Ошибка — тот же примитив с `aria-invalid` (тон
 * destructive и ring, не ручная перекраска), недоступность — нативный disabled;
 * поле с иконкой — канонический `InputGroup` (иконка живёт в аддоне, не поверх
 * инпута absolute-слоем).
 */
export function InputsGroup() {
  return (
    <div className="grid min-w-0 gap-4">
      <DevGroup
        title={devUiStrings.controls.inputs}
        hint={devUiStrings.controls.inputsHint}
        caption={devUiStrings.controls.captionInputs}
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <DevField label="Input · placeholder">
            <Input placeholder={devUiStrings.controls.inputPlaceholder} />
          </DevField>
          <DevField label="Input · value">
            <Input defaultValue={devUiStrings.controls.inputValue} />
          </DevField>
          <DevField label="Input · aria-invalid">
            <Input aria-invalid defaultValue={devUiStrings.controls.inputError} />
          </DevField>
          <DevField label="Input · disabled">
            <Input disabled placeholder={devUiStrings.controls.inputDisabled} />
          </DevField>
          <DevField label={devUiStrings.controls.captionInputIcon}>
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput placeholder={devUiStrings.controls.inputPlaceholder} />
            </InputGroup>
          </DevField>
        </div>
      </DevGroup>

      <DevGroup
        title={devUiStrings.controls.select}
        hint={devUiStrings.controls.selectHint}
        caption={devUiStrings.controls.captionSelect}
      >
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <DevField label="Select · placeholder">
            <Select>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={devUiStrings.controls.selectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">{devUiStrings.controls.optionNew}</SelectItem>
                <SelectItem value="work">{devUiStrings.controls.optionWork}</SelectItem>
                <SelectItem value="review">{devUiStrings.controls.optionReview}</SelectItem>
              </SelectContent>
            </Select>
          </DevField>
          <DevField label="Select · value">
            <Select defaultValue="work">
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">{devUiStrings.controls.optionNew}</SelectItem>
                <SelectItem value="work">{devUiStrings.controls.optionWork}</SelectItem>
                <SelectItem value="review">{devUiStrings.controls.optionReview}</SelectItem>
              </SelectContent>
            </Select>
          </DevField>
          <DevField label="Select · disabled">
            <Select disabled>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={devUiStrings.controls.selectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">{devUiStrings.controls.optionNew}</SelectItem>
              </SelectContent>
            </Select>
          </DevField>
        </div>
      </DevGroup>
    </div>
  );
}
