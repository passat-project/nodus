import { useMemo } from 'react';
import type {
  CustomFieldDefinition,
  CustomFieldModule,
  ProcessCategory,
  TransitionFormSectionKind,
  TransitionWindowField,
} from '@nodus/contracts';
import {
  CUSTOM_FIELD_LIMITS,
  FORM_LAYOUT_LIMITS,
  LOCKABLE_SYSTEM_KEYS,
  WORKFLOW_SECTIONS_BY_CATEGORY,
  bindingsOf,
  customFieldIdOfKey,
  customFieldKey,
  slotLabel,
  ui,
} from '@nodus/contracts';

import { projectsAvailable } from '../../../../../shared/api/projects-available.js';
import { TypeFormulaControl } from '../../../../../shared/custom-fields/formula/type-formula-control.js';
import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import type {
  BuilderBlockOption,
  BuilderFieldInfo,
  FormBuilderHost,
  PreviewKind,
} from '../../../../../shared/forms/builder/builder-host.js';
import type { BuilderBlock } from '../../../../../shared/forms/builder/builder-model.js';
import { FormBuilder } from '../../../../../shared/forms/builder/form-builder.js';
import { previewOfFieldType } from '../../../../../shared/forms/builder/preview-kind.js';
import {
  EMPTY_TIME_ENTRY,
  TimeEntryFields,
} from '../../../../../shared/tasks/time-entry-fields.js';
import { CommentSection } from '../../../../../shared/workflow/transition-window/sections/comment-section.js';
import { ResultFilesSection } from '../../../../../shared/workflow/transition-window/sections/result-files-section.js';
import { ResultSection } from '../../../../../shared/workflow/transition-window/sections/result-section.js';
import type { WindowDraft } from '../../../../../shared/workflow/transition-window/use-window-draft.js';
import { PanelField } from '../../../../../shared/ui/panel/panel-kit.js';
import { useRouteDocStore } from '../../../model/route-doc-store.js';
import {
  rulesFromBuilder,
  transitionBlock,
  transitionField,
  transitionFromBuilder,
  transitionToBuilder,
  WINDOW_SLOT_TYPES,
  type TransitionExtra,
} from '../../../model/transition-builder.js';
import { WINDOW_FIELDS } from '../../../model/transition-form.js';
import { validatorOf, type RuleFormOwner } from '../../../model/transition-rules.js';
import { BlockSettings } from './block-settings.js';

const b = ui.forms.builder;
const w = ui.automation.window;

const SYSTEM_PREVIEW: Readonly<Record<string, PreviewKind>> = {
  deadline: 'date',
  plannedMinutes: 'number',
  description: 'text',
  assignee: 'people',
};

/** Черновик для настоящих блоков в превью: данные пустые, ввод выключен. */
const PREVIEW_DRAFT: WindowDraft = {
  fields: {
    description: '',
    deadline: null,
    assigneeId: null,
    plannedMinutes: null,
    customFields: {},
  },
  time: { ...EMPTY_TIME_ENTRY },
  resultText: '',
  files: [],
  messages: [],
  carried: [],
  comment: '',
  registration: null,
};

const noop = (): void => {};

const BLOCK_PREVIEW: Readonly<Record<TransitionFormSectionKind, PreviewKind>> = {
  fields: 'input',
  time: 'number',
  result: 'text',
  result_files: 'select',
  result_messages: 'select',
  comment: 'text',
  registration: 'select',
};

/**
 * Редактор окна кнопки (#496, единое ядро) — вход из раздела «Окно при
 * нажатии». Поля и блоки (трудозатраты, итог, файлы, сообщения, причина,
 * регистрация) — один список с одними настройками: подпись, подсказка и
 * параметры блока. Блоки двигаются и нумеруются в том порядке, в каком их
 * увидит сотрудник; формулы полей — в тех же настройках (#632).
 */
export function TransitionWindowBuilder({
  open,
  transition,
  kind = 'transition',
  scope,
  typeId,
  category,
  readOnly,
  onClose,
}: {
  open: boolean;
  transition: RuleFormOwner;
  /** Действие (#633): то же окно, но правки идут в `patchAction`. */
  kind?: 'transition' | 'action';
  scope: CustomFieldModule;
  typeId?: string;
  category: ProcessCategory;
  readOnly: boolean;
  onClose: () => void;
}) {
  const { data: definitions } = useCustomFieldDefinitions(scope);
  const scoped = useMemo(() => definitions ?? [], [definitions]);
  const value = useMemo(
    () => transitionToBuilder(transition.form, transition.rules),
    [transition.form, transition.rules],
  );
  const host = useTransitionHost(transition, scoped, typeId, category, readOnly, kind);
  return (
    <FormBuilder
      open={open}
      host={host}
      value={value}
      readOnly={readOnly}
      onCancel={onClose}
      onDone={(next) => {
        const store = useRouteDocStore.getState();
        const patch = {
          form: transitionFromBuilder(transition.form, next),
          rules: rulesFromBuilder(transition.rules, value, next),
        };
        if (kind === 'action') store.patchAction(transition.id, patch);
        else store.patchTransition(transition.id, patch);
        onClose();
      }}
    />
  );
}

function useTransitionHost(
  transition: RuleFormOwner,
  scoped: readonly CustomFieldDefinition[],
  typeId: string | undefined,
  category: ProcessCategory,
  readOnly: boolean,
  kind: 'transition' | 'action',
): FormBuilderHost<TransitionExtra> {
  return useMemo(() => {
    const byId = new Map(scoped.map((entry) => [entry.id, entry]));
    const inType = scoped.filter(
      (entry) => !typeId || bindingsOf(entry).processTypeIds.includes(typeId),
    );
    const attributeKeys = inType.map((entry) => customFieldKey(entry.id));
    const info = (key: string): BuilderFieldInfo => {
      const fieldId = customFieldIdOfKey(key);
      if (fieldId) {
        const definition = byId.get(fieldId);
        if (!definition) return { label: b.unknownField, preview: 'input', unknown: true };
        return {
          label: definition.name,
          preview: previewOfFieldType(definition.type),
          multiline: definition.type === 'long_text',
          lockable: true,
        };
      }
      if (key === 'title' || key === 'plannedMinutes') {
        return {
          label: b.systemLabels[key],
          preview: SYSTEM_PREVIEW[key] ?? 'input',
          lockable: true,
        };
      }
      const label =
        key in ui.automation.requirableFields
          ? ui.automation.requirableFields[key as TransitionWindowField]
          : slotLabel({ key: key as never, label: null, required: false, preset: null });
      return {
        label,
        preview: SYSTEM_PREVIEW[key] ?? 'select',
        multiline: key === 'description',
        lockable: true,
      };
    };
    const hostKind = category === 'letter' ? 'letter' : 'task';
    const blockKinds = (
      WORKFLOW_SECTIONS_BY_CATEGORY[category] as readonly TransitionFormSectionKind[]
    ).filter((kind) => kind !== 'fields');
    const blocks: BuilderBlockOption[] = blockKinds.map((kind) => ({
      block: kind,
      label: w.sections[kind],
      preview: BLOCK_PREVIEW[kind],
    }));
    return {
      title: `${kind === 'action' ? b.titles.action : b.titles.transition} «${transition.name || w.preview}»`,
      info,
      catalog: [
        ...WINDOW_FIELDS.map((key) => ({ key, label: info(key).label, group: 'system' as const })),
        ...attributeKeys.map((key) => ({
          key,
          label: info(key).label,
          group: 'attribute' as const,
        })),
      ],
      makeField: transitionField,
      blocks,
      makeBlock: (block) => transitionBlock(block as TransitionFormSectionKind),
      blockSettings: (block, patch) => (
        <BlockSettings block={block} readOnly={readOnly} patch={patch} />
      ),
      renderBlock: (block) => <BlockPreview block={block} />,
      badges: (field) => (field.extra.formula ? [b.badgeFormula] : []),
      settings: (field, patch) => {
        const definition = byId.get(customFieldIdOfKey(field.key) ?? '');
        const label = info(field.key).label;
        return (
          <PanelField label={ui.formulas.typeFormula.field} hint={ui.formulas.typeFormula.hint}>
            <TypeFormulaControl
              hostKind={hostKind}
              {...(definition
                ? { definition }
                : { targetType: WINDOW_SLOT_TYPES[field.key] ?? 'text', label })}
              ownDefinitions={scoped}
              value={field.extra.formula ?? null}
              readOnly={readOnly}
              allowRelated
              onChange={(ast) => patch({ extra: { formula: ast ?? undefined } })}
            />
          </PanelField>
        );
      },
      lockMode: 'transition',
      lockable: [
        ...LOCKABLE_SYSTEM_KEYS.filter((key) => key !== 'project' || projectsAvailable()),
        ...attributeKeys,
      ].map((key) => ({ key, label: info(key).label })),
      footer: <TransitionFooter transition={transition} labelOf={(key) => info(key).label} />,
      limits: { fields: CUSTOM_FIELD_LIMITS.windowFields, decor: FORM_LAYOUT_LIMITS.decor },
    };
  }, [transition, scoped, typeId, category, readOnly, kind]);
}

/** Настоящий вид блока в редакторе — тот же, что увидит сотрудник. */
function BlockPreview({ block }: { block: BuilderBlock<TransitionExtra> }) {
  switch (block.block) {
    case 'time':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {block.extra.mode === 'always' ? w.modeAlwaysHint : w.modeIfEmptyHint}
          </p>
          <TimeEntryFields value={EMPTY_TIME_ENTRY} onChange={noop} disabled />
        </div>
      );
    case 'result':
      return <ResultSection value="" onChange={noop} disabled />;
    case 'result_files':
      return (
        <ResultFilesSection
          section={{ kind: 'result_files', label: '', origin: 'form' }}
          conversationId={null}
          draft={PREVIEW_DRAFT}
          addFiles={noop}
          toggleFile={noop}
          disabled
        />
      );
    case 'comment':
      return <CommentSection label="" value="" onChange={noop} disabled required={false} />;
    case 'result_messages':
      return <p className="text-xs text-muted-foreground">{ui.tasks.window.messagesLabel}</p>;
    case 'registration':
      return <p className="text-xs text-muted-foreground">{w.registrationHint}</p>;
    default:
      return null;
  }
}

/** Под полями: поля, которых нет в окне, но которые требует условие. */
function TransitionFooter({
  transition,
  labelOf,
}: {
  transition: RuleFormOwner;
  labelOf: (key: string) => string;
}) {
  const configured = new Set(
    transitionToBuilder(transition.form)
      .items.filter((item) => item.kind === 'field')
      .map((item) => (item as { key: string }).key),
  );
  const gateOnly = (validatorOf(transition.rules, 'fields_required')?.fields ?? []).filter(
    (key) => !configured.has(key) && key !== 'result',
  );
  if (gateOnly.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted/40 px-2 py-2 text-xs text-muted-foreground">
      <p title={b.fromGateHint}>
        {b.fromGate}: {gateOnly.map(labelOf).join(', ')}
      </p>
    </div>
  );
}
