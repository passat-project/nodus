import { useCallback, useState } from 'react';
import type {
  CustomFieldModule,
  ProcessType,
  WorkflowDetail,
  WorkflowStageName,
} from '@nodus/contracts';
import { effectiveCreationForm, ui, creationSlots } from '@nodus/contracts';

import { useRouteDocStore, type SelectionRef } from '../../../model/route-doc-store.js';
import { CreationPanel } from './creation-panel.js';
import { SidePanel } from '../../../../../shared/ui/panel/side-panel.js';
import { StageButtonsSection } from './stage-buttons-section.js';
import { StagePanel } from './stage-panel.js';
import { TransitionPanel, type TransitionSection } from './transition-panel.js';
import { ConditionsSection, RulesSection } from './transition-sections.js';
import { RolesSection } from './transition-roles-section.js';
import { DecidersSection } from './transition-deciders-section.js';
import { WindowSection } from './window-section.js';

/** Раздел панели: корень или переход внутрь (у кнопки — три раздела, у
 *  статуса — «Кнопки из статуса»). */
type PanelSection = TransitionSection | 'buttons';

const SECTION_TITLE: Record<Exclude<PanelSection, 'root'>, string> = {
  roles: ui.automation.panel.sectionWhoSees,
  deciders: ui.automation.deciders.sectionTitle,
  conditions: ui.automation.panel.sectionConditions,
  rules: ui.automation.panel.sectionRules,
  window: ui.automation.panel.sectionWindow,
  buttons: ui.automation.panel.sectionButtons,
};

const keyOf = (ref: SelectionRef) => (ref ? `${ref.kind}:${ref.id}` : null);

/**
 * Правая панель редактора (#378 ред. 2, модель Трекера): что выделено на
 * холсте — то и настраивается; у статуса, кнопки и окна создания одна
 * анатомия — поля элемента, строки «›» с переходом внутрь (стек `root |
 * раздел`, сброс к корню при смене выделения), удаление внизу. Поле окна
 * создания (#432) — переход внутрь через `field` выделения: его ставит и
 * клик по строке поля, и клик по проблеме публикации. На время закрытия
 * держит последнее содержимое — ширина уезжает плавно, а не пустой рамкой.
 * Новый элемент — фокус сразу в названии.
 */
export function EditorPanel({
  workflow,
  type,
  scope,
  readOnly,
  stageNameSuggestions = [],
  stageNameLoading = false,
}: {
  workflow: WorkflowDetail;
  /** Тип процесса: категория полей, форма создания, названия ролей (#432). */
  type: ProcessType;
  /** Область кастомных полей по категории маршрута (#431, Р7). */
  scope: CustomFieldModule;
  readOnly: boolean;
  /** Подсказки имён статусов из опубликованных маршрутов (#430). */
  stageNameSuggestions?: readonly WorkflowStageName[];
  stageNameLoading?: boolean;
}) {
  const selection = useRouteDocStore((s) => s.selection);
  const doc = useRouteDocStore((s) => s.document);
  const freshId = useRouteDocStore((s) => s.freshId);
  const [section, setSection] = useState<PanelSection>('root');
  const [shown, setShown] = useState<SelectionRef>(selection);
  const [shownKey, setShownKey] = useState(keyOf(selection));

  // Смена выделения: раздел — к корню (другой элемент), поле окна создания
  // — из свежего выделения; закрытие — последнее содержимое остаётся до
  // конца анимации ширины (derive-during-render, без эффекта).
  const key = keyOf(selection);
  if (selection && selection !== shown) {
    setShown(selection);
    if (key !== shownKey) {
      setShownKey(key);
      setSection('root');
    }
  }

  const stage =
    shown?.kind === 'stage' ? (doc.stages.find((s) => s.id === shown.id) ?? null) : null;
  const transition =
    shown?.kind === 'transition' ? (doc.transitions.find((t) => t.id === shown.id) ?? null) : null;
  const creation = shown?.kind === 'creation';
  const open = selection !== null && (stage !== null || transition !== null || creation);
  // Открыто поле окна создания, которое есть в форме ('*' и убранное — корень).
  const field = shown?.kind === 'creation' ? shown.field : undefined;
  const fieldOpen =
    field !== undefined &&
    creationSlots(effectiveCreationForm(doc.creation, type.category)).some(
      (slot) => slot.key === field,
    );

  const close = useCallback(() => useRouteDocStore.getState().select(null), []);
  const back = useCallback(() => setSection('root'), []);
  const backToCreation = useCallback(
    () => useRouteDocStore.getState().select({ kind: 'creation', id: 'creation' }),
    [],
  );
  const inSection = (stage !== null || transition !== null) && section !== 'root';

  // Шапка — вид элемента или раздел; название — первое поле панели.
  const title = inSection
    ? SECTION_TITLE[section as Exclude<PanelSection, 'root'>]
    : creation
      ? fieldOpen
        ? ui.automation.creation.slotTitle
        : ui.automation.creation.title
      : stage
        ? ui.automation.panel.kindStage
        : ui.automation.panel.kindTransition;

  return (
    <SidePanel
      open={open}
      title={title}
      onClose={close}
      onBack={inSection ? back : fieldOpen ? backToCreation : undefined}
    >
      {creation ? (
        <CreationPanel
          workflow={workflow}
          type={type}
          readOnly={readOnly}
          field={fieldOpen ? field : undefined}
        />
      ) : null}
      {stage && section === 'root' ? (
        <StagePanel
          key={stage.id}
          stage={stage}
          document={doc}
          taskCount={workflow.stageEntityCounts[stage.id] ?? 0}
          readOnly={readOnly}
          autoFocusName={freshId === stage.id}
          onOpenButtons={() => setSection('buttons')}
          stageNameSuggestions={stageNameSuggestions}
          stageNameLoading={stageNameLoading}
        />
      ) : null}
      {stage && section === 'buttons' ? (
        <StageButtonsSection stage={stage} document={doc} readOnly={readOnly} />
      ) : null}
      {transition && section === 'root' ? (
        <TransitionPanel
          key={transition.id}
          transition={transition}
          document={doc}
          readOnly={readOnly}
          category={type.category}
          autoFocusName={freshId === transition.id}
          onOpenSection={setSection}
        />
      ) : null}
      {transition && section === 'roles' ? (
        <RolesSection transition={transition} readOnly={readOnly} category={type.category} />
      ) : null}
      {transition && section === 'deciders' && type.category === 'task' ? (
        <DecidersSection transition={transition} readOnly={readOnly} />
      ) : null}
      {transition && section === 'conditions' ? (
        <ConditionsSection
          transition={transition}
          scope={scope}
          typeId={type.id}
          readOnly={readOnly}
          category={type.category}
        />
      ) : null}
      {transition && section === 'rules' ? (
        <RulesSection
          transition={transition}
          document={doc}
          readOnly={readOnly}
          category={type.category}
          typeId={type.id}
        />
      ) : null}
      {transition && section === 'window' ? (
        <WindowSection
          transition={transition}
          document={doc}
          scope={scope}
          typeId={type.id}
          readOnly={readOnly}
          category={type.category}
        />
      ) : null}
    </SidePanel>
  );
}
