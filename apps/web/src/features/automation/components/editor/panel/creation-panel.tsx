import { useMemo, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
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
  CREATION_FORM_LIMITS,
  checkWorkflowDocument,
  customFieldIdOfKey,
  effectiveCreationForm,
  slotLabel,
  typeConfigOf,
  typeIdsOf,
  ui,
} from '@nodus/contracts';
import { Eye } from 'lucide-react';

import { projectsAvailable } from '../../../../../shared/api/projects-available.js';
import { useProjectsList } from '../../../../../shared/api/projects-list.js';
import { useUsersList } from '../../../../../shared/api/users-list.js';
import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { TaskCreateWindow } from '../../../../../shared/tasks/task-create-window.js';
import { useRouteDocStore } from '../../../model/route-doc-store.js';
import {
  withChipToggled,
  withSlotAdded,
  withSlotMoved,
  withSlotPatched,
  withSlotRemoved,
} from '../../../model/creation-form.js';
import {
  presetText,
  slotSummary,
  type SlotSummaryContext,
} from '../../../model/creation-slot-summary.js';
import { CreationFieldPicker } from './creation-field-picker.js';
import { CreationSlotRow } from './creation-slot-row.js';
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
  const { data: definitions } = useCustomFieldDefinitions(type.category);
  // Все определения области, включая скрытые: скрытый атрибут бывает
  // скрытым полем формы — его имя и редактор значения нужны и здесь.
  const scoped = useMemo(
    () => (definitions ?? []).filter((entry) => entry.scope === type.category),
    [definitions, type.category],
  );
  const form = effectiveCreationForm(doc.creation, type.category);
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const opened = field ? form.fields.find((slot) => slot.key === field) : undefined;
  if (opened) {
    return (
      <CreationSlotSection
        key={opened.key}
        slot={opened}
        standardLabel={labelOf({ ...opened, label: null })}
        definition={definitionOf(opened.key)}
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

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = form.fields.findIndex((slot) => slot.key === active.id);
    const to = form.fields.findIndex((slot) => slot.key === over.id);
    if (from >= 0 && to >= 0) update(withSlotMoved(form, from, to));
  }

  const full = form.fields.length >= CREATION_FORM_LIMITS.fields;

  return (
    <>
      {doc.creation === null ? (
        <PanelNote title={c.defaultForm}>{c.defaultFormHint}</PanelNote>
      ) : null}

      <PanelField label={c.fieldsTitle}>
        {form.fields.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">{c.empty}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={form.fields.map((slot) => slot.key)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex min-w-0 flex-col">
                {form.fields.map((slot) => {
                  const first = problemsOf(slot.key)[0];
                  return (
                    <CreationSlotRow
                      key={slot.key}
                      slot={slot}
                      label={labelOf(slot)}
                      summary={slotSummary(slot, summaryCtx(slot))}
                      problem={first ? ui.automation.problems[first.code] : null}
                      readOnly={readOnly}
                      onOpen={() => select(slot.key)}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
        {readOnly ? null : (
          <CreationFieldPicker
            type={type}
            form={form}
            disabled={full}
            onPick={(key) => update(withSlotAdded(form, key))}
          />
        )}
        {full ? <p className="text-xs text-muted-foreground">{c.fieldsLimit}</p> : null}
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
      hidden: new Set(scoped.filter((entry) => entry.hidden).map((entry) => entry.id)),
      inType: new Set(
        scoped.filter((entry) => typeIdsOf(entry).includes(type.id)).map((entry) => entry.id),
      ),
    },
    definitions: scoped.map((entry) => ({
      id: entry.id,
      type: entry.type,
      settings: entry.settings,
      hidden: entry.hidden,
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
