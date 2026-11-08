import type { TransitionFormSectionKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';

import type {
  BuilderBlock,
  BlockPatch,
} from '../../../../../shared/forms/builder/builder-model.js';
import { SwitchRow } from '../../../../../shared/ui/panel/panel-kit.js';
import { SegmentedControl } from '../../../../../shared/ui/segmented-control.js';
import type { TransitionExtra } from '../../../model/transition-builder.js';

const w = ui.automation.window;

/** Параметры блока окна кнопки (#496): те же строки настроек, что у поля, —
 *  переключатель «Обязательно», выбор режима и число. Без старых галочек и
 *  второго редактора. */
export function BlockSettings({
  block,
  readOnly,
  patch,
}: {
  block: BuilderBlock<TransitionExtra>;
  readOnly: boolean;
  patch: (patch: BlockPatch<TransitionExtra>) => void;
}) {
  const kind = block.block as TransitionFormSectionKind;
  return (
    <div className="flex flex-col gap-3">
      {kind === 'time' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{w.mode}</p>
          <SegmentedControl<'if_empty' | 'always'>
            value={block.extra.mode ?? 'if_empty'}
            disabled={readOnly}
            layout="grid"
            className="w-full"
            options={[
              { value: 'if_empty', label: w.modeIfEmptyShort },
              { value: 'always', label: w.modeAlwaysShort },
            ]}
            onChange={(mode) => patch({ extra: { mode } })}
          />
          <p className="text-xs text-muted-foreground">
            {block.extra.mode === 'always' ? w.modeAlwaysHint : w.modeIfEmptyHint}
          </p>
        </div>
      ) : null}
      {kind === 'time' || kind === 'result' ? (
        <SwitchRow
          title={w.required}
          hint={w.gateHint}
          checked={block.extra.gate === true}
          disabled={readOnly}
          onChange={(gate) => patch({ extra: { gate } })}
        />
      ) : null}
      {kind === 'result_files' ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{w.minFiles}</p>
          <Input
            type="number"
            min={0}
            max={5}
            value={block.extra.minFiles ?? 0}
            readOnly={readOnly}
            aria-label={w.minFiles}
            onChange={(event) => patch({ extra: { minFiles: Number(event.target.value) } })}
          />
          <p className="text-xs text-muted-foreground">{w.filesHint}</p>
        </div>
      ) : null}
      {kind === 'result_messages' || kind === 'comment' ? (
        <SwitchRow
          title={w.required}
          checked={block.extra.required === true}
          disabled={readOnly}
          onChange={(required) => patch({ extra: { required } })}
        />
      ) : null}
      {kind === 'registration' ? (
        <p className="text-xs text-muted-foreground">{w.registrationHint}</p>
      ) : null}
    </div>
  );
}
