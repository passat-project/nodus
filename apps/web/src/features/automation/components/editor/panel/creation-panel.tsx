import { useMemo, useState } from 'react';
import type {
  CreationFieldKey,
  CreationFieldSlot,
  CreationForm,
  CustomFieldDefinition,
  ProcessType,
  WorkflowDetail,
  WorkflowDraftDocument,
  WorkflowProblem,
} from '@nodus/contracts';
import {
  bindingsOf,
  checkWorkflowDocument,
  customFieldIdOfKey,
  effectiveCreationForm,
  slotLabel,
  typeConfigOf,
  ui,
  creationSlots,
} from '@nodus/contracts';
import { Eye, LayoutTemplate } from 'lucide-react';

import { TypeFormulaControl } from '../../../../../shared/custom-fields/formula/type-formula-control.js';
import { CreationWindowBuilder } from '../window-builder/creation-window-builder.js';

import { projectsAvailable } from '../../../../../shared/api/projects-available.js';
import { useProjectsList } from '../../../../../shared/api/projects-list.js';
import { useUsersList } from '../../../../../shared/api/users-list.js';
import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { TaskCreateWindow } from '../../../../../shared/tasks/task-create-window.js';
import { useRouteDocStore } from '../../../model/route-doc-store.js';
import { withChipToggled, withSlotPatched, withSlotRemoved } from '../../../model/creation-form.js';
import { presetText, type SlotSummaryContext } from '../../../model/creation-slot-summary.js';
import { CreationSlotSection } from './creation-slot-section.js';
import {
  PanelAction,
  PanelField,
  PanelNote,
  SwitchRow,
} from '../../../../../shared/ui/panel/panel-kit.js';

const c = ui.automation.creation;

/**
 * Панель «Окно создания» (#432, В1/Р12): узел «Создание» холста маршрута —
 * та же анатомия, что у панелей статуса и кнопки. В корне — список полей
 * строками «Название ›» со сводкой (порядок — перетаскиванием и с
 * клавиатуры), тихое «+ Поле», тумблеры блоков внизу окна и «Посмотреть
 * окно» — НАСТОЯЩЕЕ окно по центру экрана, там, где его увидит сотрудник
 * (вердикт владельца 26.10.2026: предпросмотр в панели не нужен). Настройка
 * поля — переход внутрь (`field` выделения, шапка «Поле окна» со стрелкой
 * назад; клик по проблеме публикации открывает поле сразу). Правки —
 * раздел документа: черновик, история и «Опубликовать» общие с маршрутом.
 */
export function CreationPanel({
  workflow,
  type,
  readOnly,
  field,
}: {
  workflow: WorkflowDetail;
  type: ProcessType;
  readOnly: boolean;
  /** Открытое поле (раздел поля); нет — корень со списком. */
  field?: string;
}) {
  const doc = useRouteDocStore((s) => s.document);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
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
  const lookups = usePresetLookups();
  const roleLabels = typeConfigOf(type).card.roleLabels;

  const update = (next: CreationForm, coalesce?: string) =>
    useRouteDocStore.getState().setCreationForm(next, coalesce);
  const select = (key?: CreationFieldKey) =>
    useRouteDocStore
      .getState()
      .select(
        key
          ? { kind: 'creation', id: 'creation', field: key }
          : { kind: 'creation', id: 'creation' },
      );
  const definitionOf = (key: CreationFieldKey): CustomFieldDefinition | undefined => {
    const id = customFieldIdOfKey(key);
    return id ? scoped.find((entry) => entry.id === id) : undefined;
  };
  const labelOf = (slot: CreationFieldSlot) => slotLabel(slot, { roleLabels, definitions: scoped });
  const problemsOf = (key: string) => problems.filter((problem) => problem.creationField === key);
  const summaryCtx = (slot: CreationFieldSlot): SlotSummaryContext => ({
    definition: definitionOf(slot.key),
    ...lookups,
  });

  const opened = field ? slots.find((slot) => slot.key === field) : undefined;
  if (opened) {
    return (
      <CreationSlotSection
        key={opened.key}
        slot={opened}
        standardLabel={labelOf({ ...opened, label: null })}
        definition={definitionOf(opened.key)}
        ownDefinitions={scoped}
        hostKind={type.category === 'letter' ? 'letter' : 'task'}
        presetLabel={presetText(opened, summaryCtx(opened))}
        problems={problemsOf(opened.key)}
        readOnly={readOnly}
        onChange={(patch, coalesce) => update(withSlotPatched(form, opened.key, patch), coalesce)}
        onRemove={() => {
          update(withSlotRemoved(form, opened.key));
          select();
        }}
      />
    );
  }

  return (
    <>
      {doc.creation === null ? (
        <PanelNote title={c.defaultForm}>{c.defaultFormHint}</PanelNote>
      ) : null}

      {/* Единый путь настройки (#496, вердикт владельца): поля, порядок и
          раскладка — только в редакторе окна; здесь проблемы публикации
          (клик — к полю) и вход в редактор. */}
      {problems.length > 0 ? (
        <div role="alert" className="flex min-w-0 flex-col gap-1">
          {problems.map((problem, index) => (
            <button
              key={`${problem.code}-${index}`}
              type="button"
              className="text-left text-xs break-words text-danger hover:underline"
              onClick={() =>
                problem.creationField && slots.some((slot) => slot.key === problem.creationField)
                  ? select(problem.creationField as CreationFieldKey)
                  : setBuilderOpen(true)
              }
            >
              {ui.automation.problems[problem.code]}
            </button>
          ))}
        </div>
      ) : null}

      {/* Редактор окна (#496, В8): раскладка, оформление и замки — в окне
          в натуральную величину; список выше — быстрый вход в поле. */}
      <PanelAction icon={LayoutTemplate} onClick={() => setBuilderOpen(true)}>
        {readOnly ? ui.forms.builder.view : ui.forms.builder.edit}
      </PanelAction>
      <p className="-mt-2 text-xs text-muted-foreground">
        {ui.forms.builder.summary(slots.length, form.locks?.length ?? 0)}
      </p>

      {/* Формула названия (#496, Р7): строкой панели, не в редакторе окна —
          название не элемент раскладки, оно всегда первым. */}
      <PanelField label={ui.forms.builder.titleFormula} hint={ui.forms.builder.titleFormulaHint}>
        <TypeFormulaControl
          hostKind={type.category === 'letter' ? 'letter' : 'task'}
          targetType="text"
          label={ui.forms.builder.systemLabels.title}
          ownDefinitions={scoped}
          value={form.titleFormula ?? null}
          readOnly={readOnly}
          allowRelated
          onChange={(ast) => update({ ...form, titleFormula: ast })}
        />
      </PanelField>

      <PanelField label={c.chipsTitle}>
        <div className="flex min-w-0 flex-col gap-3">
          <SwitchRow
            title={c.chipChecklist}
            hint={c.chipChecklistHint}
            checked={form.chips.includes('checklist')}
            disabled={readOnly}
            onChange={() => update(withChipToggled(form, 'checklist'))}
          />
          <SwitchRow
            title={c.chipPlanned}
            hint={c.chipPlannedHint}
            checked={form.chips.includes('planned')}
            disabled={readOnly}
            onChange={() => update(withChipToggled(form, 'planned'))}
          />
        </div>
      </PanelField>

      <PanelAction icon={Eye} onClick={() => setPreviewOpen(true)}>
        {c.previewOpen}
      </PanelAction>
      <TaskCreateWindow
        open={previewOpen}
        prefill={null}
        preview={{ type, form }}
        onClose={() => setPreviewOpen(false)}
      />
      <CreationWindowBuilder
        open={builderOpen}
        type={type}
        form={form}
        readOnly={readOnly}
        onClose={() => setBuilderOpen(false)}
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

/** Имена для сводок скрытых значений: сотрудники и проекты — из общих
 *  справочников (кэш тот же, что у пикеров). */
function usePresetLookups(): Pick<SlotSummaryContext, 'userName' | 'projectName'> {
  const { data: users } = useUsersList();
  const { data: projects } = useProjectsList({ enabled: projectsAvailable() });
  return useMemo(() => {
    const userNames = new Map((users?.items ?? []).map((user) => [user.id, user.displayName]));
    const projectNames = new Map((projects?.items ?? []).map((item) => [item.id, item.name]));
    return {
      userName: (id: string) => userNames.get(id),
      projectName: (id: string) => projectNames.get(id),
    };
  }, [users, projects]);
}
