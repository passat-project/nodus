import type { TransitionFormSectionDraft } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';

import type {
  BuilderField,
  FieldPatch,
} from '../../../../../shared/forms/builder/builder-model.js';
import { ModeChoices, PanelField } from '../../../../../shared/ui/panel/panel-kit.js';
import type { TransitionExtra } from '../../../model/transition-builder.js';
import { RequiredCheck } from '../panel/window-section-rows.js';

const w = ui.automation.window;

/**
 * Настройки поля-раздела окна кнопки в редакторе (#496, вердикт владельца:
 * разделы — обычные поля окна): режим трудозатрат, «Обязательно» (гейт у
 * трудозатрат и итога, свойство раздела у сообщений и причины), подпись и
 * минимум файлов. Всё — в черновике редактора до «Готово».
 */
export function SectionSettings({
  field,
  readOnly,
  patch,
}: {
  field: BuilderField<TransitionExtra>;
  readOnly: boolean;
  patch: (patch: FieldPatch<TransitionExtra>) => void;
}) {
  const section = field.extra.section;
  if (!section) return null;
  const setSection = (next: TransitionFormSectionDraft) => patch({ extra: { section: next } });
  const gate = (
    <RequiredCheck
      checked={field.extra.gate === true}
      disabled={readOnly}
      onChange={(checked) => patch({ extra: { gate: checked } })}
    />
  );
  switch (section.kind) {
    case 'time':
      return (
        <div className="flex flex-col gap-2">
          <ModeChoices
            value={section.mode}
            disabled={readOnly}
            options={[
              { value: 'if_empty', label: w.modeIfEmpty, hint: w.modeIfEmptyHint },
              { value: 'always', label: w.modeAlways, hint: w.modeAlwaysHint },
            ]}
            onChange={(mode) => setSection({ kind: 'time', mode })}
          />
          {gate}
        </div>
      );
    case 'result':
      return gate;
    case 'result_files':
      return (
        <>
          <PanelField label={w.label}>
            <Input
              value={section.label}
              maxLength={60}
              readOnly={readOnly}
              placeholder={w.labelPlaceholder}
              onChange={(e) => setSection({ ...section, label: e.target.value.slice(0, 60) })}
            />
          </PanelField>
          <PanelField label={w.minFiles} hint={w.filesHint}>
            <Input
              type="number"
              min={0}
              max={5}
              value={field.extra.minFiles ?? 0}
              readOnly={readOnly}
              aria-label={w.minFiles}
              onChange={(e) => patch({ extra: { minFiles: Number(e.target.value) } })}
            />
          </PanelField>
        </>
      );
    case 'result_messages':
      return (
        <RequiredCheck
          checked={section.required}
          disabled={readOnly}
          onChange={(required) => setSection({ ...section, required })}
        />
      );
    case 'comment':
      return (
        <>
          <PanelField label={w.label}>
            <Input
              value={section.label}
              maxLength={60}
              readOnly={readOnly}
              placeholder={w.labelPlaceholder}
              onChange={(e) => setSection({ ...section, label: e.target.value.slice(0, 60) })}
            />
          </PanelField>
          <RequiredCheck
            checked={section.required}
            disabled={readOnly}
            onChange={(required) => setSection({ ...section, required })}
          />
          <p className="text-xs text-muted-foreground">{w.commentHint}</p>
        </>
      );
    case 'registration':
      return <p className="text-xs text-muted-foreground">{w.registrationHint}</p>;
    default:
      return null;
  }
}
