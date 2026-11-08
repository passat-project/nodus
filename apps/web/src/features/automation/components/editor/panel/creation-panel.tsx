import { useMemo, useState } from 'react';
import type {
  CustomFieldDefinition,
  ProcessType,
  WorkflowDetail,
  WorkflowDraftDocument,
  WorkflowProblem,
} from '@nodus/contracts';
import {
  bindingsOf,
  checkWorkflowDocument,
  effectiveCreationForm,
  ui,
  creationSlots,
} from '@nodus/contracts';
import { LayoutTemplate } from 'lucide-react';

import { projectsAvailable } from '../../../../../shared/api/projects-available.js';
import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { useRouteDocStore } from '../../../model/route-doc-store.js';
import { CreationWindowBuilder } from '../window-builder/creation-window-builder.js';
import { PanelAction, PanelNote } from '../../../../../shared/ui/panel/panel-kit.js';

const c = ui.automation.creation;

/**
 * Панель «Окно создания» (#432; #496 — единый путь настройки): тумблер
 * формы нет — окно есть у каждого типа, — поэтому здесь только проблемы
 * публикации (клик открывает поле в редакторе) и вход «Редактировать окно».
 * Поля, порядок, оформление, блоки, формулы и замки — только в редакторе:
 * второго места настройки и второй карточки поля больше нет.
 */
export function CreationPanel({
  workflow,
  type,
  readOnly,
}: {
  workflow: WorkflowDetail;
  type: ProcessType;
  readOnly: boolean;
}) {
  const doc = useRouteDocStore((s) => s.document);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const { data: definitions } = useCustomFieldDefinitions(type.category);
  // Определения уже отфильтрованы по модулю запросом (`?module=`).
  const scoped = useMemo(() => definitions ?? [], [definitions]);
  const form = effectiveCreationForm(doc.creation, type.category);
  const slots = creationSlots(form);
  // `workflow.version` — подсказки пересчитываются после публикации.
  const problems = useMemo(
    () => creationProblems(doc, scoped, type, workflow.version),
    [doc, scoped, type, workflow.version],
  );
  const open = (key?: string) => {
    setFocusKey(key ?? null);
    setBuilderOpen(true);
  };

  return (
    <>
      {doc.creation === null ? (
        <PanelNote title={c.defaultForm}>{c.defaultFormHint}</PanelNote>
      ) : null}

      {problems.length > 0 ? (
        <div role="alert" className="flex min-w-0 flex-col gap-1">
          {problems.map((problem, index) => (
            <button
              key={`${problem.code}-${index}`}
              type="button"
              className="text-left text-xs break-words text-danger hover:underline"
              onClick={() => open(problem.creationField)}
            >
              {ui.automation.problems[problem.code]}
            </button>
          ))}
        </div>
      ) : null}

      <PanelAction icon={LayoutTemplate} onClick={() => open()}>
        {readOnly ? ui.forms.builder.view : ui.forms.builder.edit}
      </PanelAction>
      <p className="-mt-2 text-xs text-muted-foreground">
        {ui.forms.builder.summary(slots.length, form.locks?.length ?? 0)}
      </p>

      <CreationWindowBuilder
        open={builderOpen}
        type={type}
        form={form}
        readOnly={readOnly}
        focusKey={focusKey}
        onClose={() => {
          setBuilderOpen(false);
          setFocusKey(null);
        }}
      />
    </>
  );
}

/** Проблемы публикации формы — та же проверка, что у чипа публикации,
 *  с фактами реестра и привязок типа (Р8). */
function creationProblems(
  doc: WorkflowDraftDocument,
  scoped: readonly CustomFieldDefinition[],
  type: ProcessType,
  version: number,
): WorkflowProblem[] {
  void version;
  return checkWorkflowDocument(doc, {
    category: type.category,
    customFields: {
      active: new Set(scoped.map((entry) => entry.id)),
      inType: new Set(
        scoped
          .filter((entry) => bindingsOf(entry).processTypeIds.includes(type.id))
          .map((entry) => entry.id),
      ),
    },
    definitions: scoped.map((entry) => ({
      id: entry.id,
      type: entry.type,
      settings: entry.settings,
    })),
    projectsAvailable: projectsAvailable(),
  }).filter((problem) => problem.code.startsWith('creation_') || problem.creationField);
}
