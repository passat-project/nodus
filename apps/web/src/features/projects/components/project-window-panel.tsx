import { useMemo, useState } from 'react';
import type { ProjectType } from '@nodus/contracts';
import { isFormDecor, projectTypeFormOf, ui, withProjectSystemElements } from '@nodus/contracts';
import { LayoutTemplate } from 'lucide-react';

import { SidePanel } from '../../../shared/ui/panel/side-panel.js';
import { PanelNote, SectionLink } from '../../../shared/ui/panel/panel-kit.js';
import type { RenderCreateField } from '../node-kinds/types.js';
import { ProjectWindowBuilder } from './project-window-builder.js';

/**
 * Панель «Окно создания проекта» (#496): тот же сценарий, что у узла
 * «создание» в «Процессах», — клик по узлу на канвасе открывает правую
 * панель, в ней сводка состава и вход «Редактировать окно». Сам редактор —
 * окно поверх экрана; отдельного места настройки у типа нет.
 */
export function ProjectWindowPanel({
  type,
  open,
  canSetup,
  canCreateField,
  renderCreateField,
  onClose,
}: {
  type: ProjectType | null;
  open: boolean;
  /** Право `project.setup.manage` — правка; иначе только просмотр. */
  canSetup: boolean;
  canCreateField: boolean;
  renderCreateField?: RenderCreateField;
  onClose: () => void;
}) {
  const [builderOpen, setBuilderOpen] = useState(false);
  const form = useMemo(
    () => (type ? withProjectSystemElements(projectTypeFormOf(type)) : null),
    [type],
  );
  const fields = useMemo(
    () => (form ? form.fields.filter((element) => !isFormDecor(element)).length : 0),
    [form],
  );

  if (!type || !form) {
    return (
      <SidePanel open={false} title={ui.projects.schemasWindowPanel} onClose={onClose}>
        {null}
      </SidePanel>
    );
  }

  return (
    <SidePanel
      open={open}
      title={ui.projects.schemasWindowPanel}
      leading={
        <span className="flex size-6 items-center justify-center rounded border border-border text-muted-foreground">
          <LayoutTemplate className="size-3.5" strokeWidth={1.75} />
        </span>
      }
      onClose={() => {
        setBuilderOpen(false);
        onClose();
      }}
    >
      {projectTypeFormOf(type).fields.length === 0 ? (
        <PanelNote title={ui.projects.schemasWindowNote}>
          {ui.projects.schemasWindowNoteHint}
        </PanelNote>
      ) : null}
      <SectionLink
        title={canSetup ? ui.forms.builder.edit : ui.forms.builder.view}
        summary={ui.forms.builder.summary(fields, 0)}
        onClick={() => setBuilderOpen(true)}
      />
      <ProjectWindowBuilder
        open={builderOpen}
        type={type}
        canSetup={canSetup}
        canCreateField={canCreateField}
        renderCreateField={renderCreateField}
        onClose={() => setBuilderOpen(false)}
      />
    </SidePanel>
  );
}
