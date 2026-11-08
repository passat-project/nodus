import type { ProcessCategory, WorkflowDraftTransition } from '@nodus/contracts';
import { WORKFLOW_SECTIONS_BY_CATEGORY, ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';

import { useRouteDocStore } from '../../../model/route-doc-store.js';
import {
  sectionOf,
  setLabel,
  setRequired,
  setTimeMode,
  toggleSection,
} from '../../../model/transition-form.js';
import { setMinFiles, validatorOf } from '../../../model/transition-rules.js';
import { ModeChoices, PanelField } from '../../../../../shared/ui/panel/panel-kit.js';
import { GateCheck, RequiredCheck, SectionToggle } from './window-section-rows.js';

/**
 * Разделы окна кнопки (#380) внутри редактора окна (#496, вердикт владельца:
 * единый путь настройки — всё окно настраивается в редакторе, в панели
 * только вход). Время, итог, файлы, сообщения, причина, регистрация —
 * под полями окна. Правка раздела сразу попадает в черновик маршрута.
 */
export function WindowSectionsControls({
  transition,
  readOnly,
  category,
}: {
  transition: WorkflowDraftTransition;
  readOnly: boolean;
  category: ProcessCategory;
}) {
  const form = transition.form;
  const allowed = WORKFLOW_SECTIONS_BY_CATEGORY[category] as readonly string[];
  const has = (kind: string) => allowed.includes(kind);
  const patch = (next: Partial<WorkflowDraftTransition['form']>) =>
    useRouteDocStore.getState().patchTransition(transition.id, { form: { ...form, ...next } });
  const toggle = (kind: Parameters<typeof toggleSection>[1]) => patch(toggleSection(form, kind));

  return (
    <div className="flex min-w-0 flex-col gap-3 px-2 pt-2">
      {has('registration') ? (
        <SectionToggle
          kind="registration"
          transition={transition}
          readOnly={readOnly}
          onToggle={() => toggle('registration')}
        >
          <p className="text-xs text-muted-foreground">{ui.automation.window.registrationHint}</p>
        </SectionToggle>
      ) : null}

      {has('time') ? (
        <SectionToggle
          kind="time"
          transition={transition}
          readOnly={readOnly}
          onToggle={() => toggle('time')}
        >
          <div className="flex flex-col gap-2">
            <ModeChoices
              value={sectionOf(form, 'time')?.mode ?? 'if_empty'}
              disabled={readOnly}
              options={[
                {
                  value: 'if_empty',
                  label: ui.automation.window.modeIfEmpty,
                  hint: ui.automation.window.modeIfEmptyHint,
                },
                {
                  value: 'always',
                  label: ui.automation.window.modeAlways,
                  hint: ui.automation.window.modeAlwaysHint,
                },
              ]}
              onChange={(mode) => patch(setTimeMode(form, mode))}
            />
            <GateCheck transition={transition} kind="time_logged" disabled={readOnly} />
          </div>
        </SectionToggle>
      ) : null}

      {has('result') ? (
        <SectionToggle
          kind="result"
          transition={transition}
          readOnly={readOnly}
          onToggle={() => toggle('result')}
        >
          <GateCheck transition={transition} kind="result_present" disabled={readOnly} />
        </SectionToggle>
      ) : null}

      {has('result_files') ? (
        <SectionToggle
          kind="result_files"
          transition={transition}
          readOnly={readOnly}
          onToggle={() => toggle('result_files')}
        >
          <div className="flex flex-col gap-2">
            <PanelField label={ui.automation.window.label}>
              <Input
                value={sectionOf(form, 'result_files')?.label ?? ''}
                maxLength={60}
                readOnly={readOnly}
                placeholder={ui.automation.window.labelPlaceholder}
                onChange={(e) => patch(setLabel(form, 'result_files', e.target.value))}
              />
            </PanelField>
            <PanelField label={ui.automation.window.minFiles} hint={ui.automation.window.filesHint}>
              <Input
                type="number"
                min={0}
                max={5}
                value={validatorOf(transition.rules, 'result_files')?.min ?? 0}
                readOnly={readOnly}
                aria-label={ui.automation.window.minFiles}
                onChange={(e) =>
                  useRouteDocStore.getState().patchTransition(transition.id, {
                    rules: setMinFiles(transition.rules, Number(e.target.value)),
                  })
                }
              />
            </PanelField>
          </div>
        </SectionToggle>
      ) : null}

      {has('result_messages') ? (
        <SectionToggle
          kind="result_messages"
          transition={transition}
          readOnly={readOnly}
          onToggle={() => toggle('result_messages')}
        >
          <RequiredCheck
            checked={sectionOf(form, 'result_messages')?.required ?? false}
            disabled={readOnly}
            onChange={(checked) => patch(setRequired(form, 'result_messages', checked))}
          />
        </SectionToggle>
      ) : null}

      {has('comment') ? (
        <SectionToggle
          kind="comment"
          transition={transition}
          readOnly={readOnly}
          onToggle={() => toggle('comment')}
        >
          <div className="flex flex-col gap-2">
            <PanelField label={ui.automation.window.label}>
              <Input
                value={sectionOf(form, 'comment')?.label ?? ''}
                maxLength={60}
                readOnly={readOnly}
                placeholder={ui.automation.window.labelPlaceholder}
                onChange={(e) => patch(setLabel(form, 'comment', e.target.value))}
              />
            </PanelField>
            <RequiredCheck
              checked={sectionOf(form, 'comment')?.required ?? false}
              disabled={readOnly}
              onChange={(checked) => patch(setRequired(form, 'comment', checked))}
            />
            <p className="text-xs text-muted-foreground">{ui.automation.window.commentHint}</p>
          </div>
        </SectionToggle>
      ) : null}
    </div>
  );
}
