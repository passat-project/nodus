import { useState } from 'react';
import type {
  CustomFieldModule,
  ProcessCategory,
  WorkflowDraftDocument,
  WorkflowDraftTransition,
} from '@nodus/contracts';
import { ui, windowFieldKeys } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { Eye, LayoutTemplate } from 'lucide-react';

import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { useRouteDocStore } from '../../../model/route-doc-store.js';
import { sectionOf, setWindowEnabled, setWindowTitle } from '../../../model/transition-form.js';
import { PanelAction, PanelField, SwitchRow } from '../../../../../shared/ui/panel/panel-kit.js';
import { TransitionWindowBuilder } from '../window-builder/transition-window-builder.js';
import { WindowPreview } from './window-preview.js';

const l = ui.forms.locks;

/**
 * Раздел «Окно перехода» инспектора кнопки (#380; #496 — единый путь
 * настройки): тумблер окна, заголовок и вход «Редактировать окно». Поля,
 * их раскладка, оформление, замки и разделы окна (время, итог, файлы,
 * сообщения, причина, регистрация) — только в редакторе окна, здесь
 * сводка. Выключение окна с замками — с подтверждением: пока окно
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
  /** Разделы окна категории (Р6). */
  category?: ProcessCategory;
}) {
  const form = transition.form;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const { data: definitions } = useCustomFieldDefinitions(scope);
  const patch = (next: Partial<WorkflowDraftTransition['form']>) =>
    useRouteDocStore.getState().patchTransition(transition.id, { form: { ...form, ...next } });
  const fieldsSection = sectionOf(form, 'fields');
  const fieldCount = fieldsSection ? windowFieldKeys(fieldsSection).length : 0;
  const lockCount = form.locks?.length ?? 0;
  const otherSections = form.sections
    .filter((section) => section.kind !== 'fields')
    .map((section) => ui.automation.window.sections[section.kind]);

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
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm">{ui.forms.builder.summary(fieldCount, lockCount)}</p>
            {otherSections.length > 0 ? (
              <p className="text-xs break-words text-muted-foreground">
                {otherSections.join(', ')}
              </p>
            ) : null}
          </div>
          <PanelAction icon={LayoutTemplate} onClick={() => setBuilderOpen(true)}>
            {readOnly ? ui.forms.builder.view : ui.forms.builder.edit}
          </PanelAction>
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
