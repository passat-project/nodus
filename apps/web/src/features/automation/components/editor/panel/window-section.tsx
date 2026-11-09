import { useState } from 'react';
import type { CustomFieldModule, ProcessCategory, WorkflowDraftTransition } from '@nodus/contracts';
import { ui, windowFieldKeys } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';

import { useRouteDocStore } from '../../../model/route-doc-store.js';
import { sectionOf, setWindowEnabled, setWindowTitle } from '../../../model/transition-form.js';
import { PanelField, SectionLink, SwitchRow } from '../../../../../shared/ui/panel/panel-kit.js';
import { TransitionWindowBuilder } from '../window-builder/transition-window-builder.js';

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
  scope,
  typeId,
  readOnly,
  category = 'task',
}: {
  transition: WorkflowDraftTransition;
  scope: CustomFieldModule;
  /** Тип процесса: в окно выбираются только его атрибуты (#432, Р8). */
  typeId?: string;
  readOnly: boolean;
  /** Разделы окна категории (Р6). */
  category?: ProcessCategory;
}) {
  const form = transition.form;
  const [builderOpen, setBuilderOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const patch = (next: Partial<WorkflowDraftTransition['form']>) =>
    useRouteDocStore.getState().patchTransition(transition.id, { form: { ...form, ...next } });
  const fieldsSection = sectionOf(form, 'fields');
  const fieldCount = fieldsSection ? windowFieldKeys(fieldsSection).length : 0;
  const lockCount = form.locks?.length ?? 0;
  const otherSections = form.sections
    .filter((section) => section.kind !== 'fields')
    .map((section) =>
      section.label?.trim() ? section.label : ui.automation.window.sections[section.kind],
    );
  const summaryParts = [
    ...(fieldCount > 0 || lockCount > 0
      ? [ui.forms.builder.summary(fieldCount, lockCount)]
      : []),
    ...(otherSections.length > 0 ? [otherSections.join(', ')] : []),
  ];
  const summary =
    summaryParts.length > 0 ? summaryParts.join(' · ') : ui.forms.builder.emptyWindow;

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
          {/* Вход в редактор — строка раздела, как «Кнопки из статуса»:
              название, сводка состава (поля · разделы · замки), шеврон. */}
          <SectionLink
            title={readOnly ? ui.forms.builder.view : ui.forms.builder.edit}
            summary={summary}
            onClick={() => setBuilderOpen(true)}
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
