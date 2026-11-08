import { useState } from 'react';
import type {
  CustomFieldModule,
  ProcessCategory,
  WorkflowDraftDocument,
  WorkflowDraftTransition,
} from '@nodus/contracts';
import { WORKFLOW_SECTIONS_BY_CATEGORY, ui, windowFieldKeys } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { Eye, LayoutTemplate } from 'lucide-react';

import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { useRouteDocStore } from '../../../model/route-doc-store.js';
import {
  sectionOf,
  setLabel,
  setRequired,
  setTimeMode,
  setWindowEnabled,
  setWindowTitle,
  toggleSection,
} from '../../../model/transition-form.js';
import { setMinFiles, validatorOf } from '../../../model/transition-rules.js';
import {
  ModeChoices,
  PanelAction,
  PanelField,
  SwitchRow,
} from '../../../../../shared/ui/panel/panel-kit.js';
import { TransitionWindowBuilder } from '../window-builder/transition-window-builder.js';
import { GateCheck, RequiredCheck, SectionToggle } from './window-section-rows.js';
import { WindowPreview } from './window-preview.js';

const l = ui.forms.locks;

/**
 * Раздел «Окно перехода» инспектора кнопки (#380): тумблер окна,
 * заголовок, разделы в фиксированном порядке. «Обязательно» у
 * времени/итога/файлов правит ГЕЙТЫ (Р3: обязательность — только
 * валидаторы), у причины и сообщений — собственную настройку раздела.
 * Поля окна (#431/#632) и их раскладка, оформление и замки (#496) — в
 * редакторе окна («Редактировать окно»): здесь сводка «3 поля · 1
 * закреплено». Выключение окна с замками — с подтверждением: пока окно
 * выключено, кнопка ничего не закрепляет (В13).
 */
export function WindowSection({
  transition,
  document: doc,
  scope,
  typeId,
  readOnly,
  category = 'task',
}: {
  transition: WorkflowDraftTransition;
  document: WorkflowDraftDocument;
  scope: CustomFieldModule;
  /** Тип процесса: в окно выбираются только его атрибуты (#432, Р8). */
  typeId?: string;
  readOnly: boolean;
  /** Разделы окна категории (Р6): у письма — «Регистрация» и «Причина /
   *  комментарий», задачных (время, итог, файлы) нет. */
  category?: ProcessCategory;
}) {
  const form = transition.form;
  const allowedSections = WORKFLOW_SECTIONS_BY_CATEGORY[category] as readonly string[];
  const has = (kind: string) => allowedSections.includes(kind);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const { data: definitions } = useCustomFieldDefinitions(scope);
  const patch = (next: Partial<WorkflowDraftTransition['form']>) =>
    useRouteDocStore.getState().patchTransition(transition.id, { form: { ...form, ...next } });
  const toggle = (kind: Parameters<typeof toggleSection>[1]) => patch(toggleSection(form, kind));
  const fieldsSection = sectionOf(form, 'fields');
  const fieldCount = fieldsSection ? windowFieldKeys(fieldsSection).length : 0;
  const lockCount = form.locks?.length ?? 0;

  return (
    <>
      <SwitchRow
        title={ui.automation.window.enable}
        hint={ui.automation.window.titleHint}
        checked={form.enabled}
        disabled={readOnly}
        onChange={(checked) => {
          if (!checked && lockCount > 0) setConfirmOff(true);
          else patch(setWindowEnabled(form, checked));
        }}
      />
      {form.enabled ? (
        <>
          <PanelField label={ui.automation.window.titleLabel} hint={ui.automation.window.titleHint}>
            <Input
              value={form.title ?? ''}
              maxLength={60}
              readOnly={readOnly}
              placeholder={transition.name || ui.automation.window.titlePlaceholder}
              onChange={(e) => patch(setWindowTitle(form, e.target.value))}
            />
          </PanelField>

          {has('registration') ? (
            <SectionToggle
              kind="registration"
              transition={transition}
              readOnly={readOnly}
              onToggle={() => toggle('registration')}
            >
              <p className="text-xs text-muted-foreground">
                {ui.automation.window.registrationHint}
              </p>
            </SectionToggle>
          ) : null}

          {has('fields') ? (
            <PanelField
              label={ui.automation.window.sections.fields}
              hint={ui.automation.window.fieldsHint}
            >
              <p className="text-sm">{ui.forms.builder.summary(fieldCount, lockCount)}</p>
              <PanelAction icon={LayoutTemplate} onClick={() => setBuilderOpen(true)}>
                {readOnly ? ui.forms.builder.view : ui.forms.builder.edit}
              </PanelAction>
            </PanelField>
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
                <PanelField
                  label={ui.automation.window.minFiles}
                  hint={ui.automation.window.filesHint}
                >
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

          <PanelAction icon={Eye} onClick={() => setPreviewOpen(true)}>
            {ui.automation.window.preview}
          </PanelAction>
          <WindowPreview
            open={previewOpen}
            transition={transition}
            document={doc}
            definitions={definitions ?? []}
            onClose={() => setPreviewOpen(false)}
          />
          <TransitionWindowBuilder
            open={builderOpen}
            transition={transition}
            scope={scope}
            typeId={typeId}
            category={category}
            readOnly={readOnly}
            onClose={() => setBuilderOpen(false)}
          />
        </>
      ) : null}
      <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogTitle className="text-base font-medium">{l.disableTitle}</DialogTitle>
          <p className="text-sm text-muted-foreground">{l.disableLead}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setConfirmOff(false)}>
              {ui.common.cancel}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmOff(false);
                patch(setWindowEnabled(form, false));
              }}
            >
              {l.disableConfirm}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
