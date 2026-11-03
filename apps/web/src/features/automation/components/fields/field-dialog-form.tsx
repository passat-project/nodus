import type { ReactNode } from 'react';
import type { CustomFieldDefinition, CustomFieldScope } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { Switch } from '@nodus/ui/components/switch';
import { Textarea } from '@nodus/ui/components/textarea';
import { cn } from '@nodus/ui/lib/utils';

import {
  draftDefinition,
  draftType,
  isListFamily,
  type DraftIssue,
  type FieldDraft,
} from '../../lib/field-draft.js';
import { familyModifier, modifierOf } from '../../lib/field-type-families.js';
import { FieldDefaultValue } from './field-default-value.js';
import { FieldOptionsEditor } from './field-options-editor.js';
import { FieldSettings, SettingRow } from './field-settings.js';
import { FieldTypesPicker, NodeKindsSummary } from './field-types-picker.js';

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <NodeLabel label={label} />
      {children}
    </section>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * Правая колонка окна атрибута: «Основное» (название, подсказка),
 * «Настройки» типа, «Варианты» списка, «Значение по умолчанию», «Видимость».
 * Секции разделяются отступами, не линиями (канон сепараторов). Тип не
 * выбран — честная заглушка на месте формы (высота окна не меняется).
 */
export function FieldDialogForm({
  draft,
  scope,
  definition,
  shared,
  disabled,
  optionsReadOnly,
  errors,
  issues,
  currencyFallback,
  removedOptions,
  onChange,
}: {
  draft: FieldDraft | null;
  scope: CustomFieldScope;
  definition: CustomFieldDefinition | null;
  shared: boolean;
  disabled: boolean;
  /** Без `dictionary.manage` варианты списка — только чтение (#491). */
  optionsReadOnly: boolean;
  errors: { name?: string; options?: string };
  issues: readonly DraftIssue[];
  currencyFallback: string | null;
  /** Сколько сохранённых вариантов удалено в черновике (честное предупреждение). */
  removedOptions: number;
  onChange: (next: Partial<FieldDraft>) => void;
}) {
  if (draft === null) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    );
  }

  const family = draft.family;
  const type = draftType(draft);
  const list = isListFamily(family);
  const preview = draftDefinition(draft, scope, currencyFallback);
  const savedModifier = definition !== null && modifierOf(definition.type) !== null;
  const hasSettings =
    family !== null &&
    (familyModifier(family) !== null || family === 'number' || family === 'money');

  return (
    <div className="flex flex-col gap-5 pb-1">
      <Section label={ui.customFields.dialog.main}>
        <Labeled label={ui.customFields.dialog.name}>
          <Input
            autoFocus={definition === null}
            value={draft.name}
            maxLength={60}
            disabled={disabled}
            placeholder={ui.customFields.dialog.namePlaceholder}
            aria-invalid={errors.name !== undefined || undefined}
            onChange={(e) => onChange({ name: e.target.value })}
            className="h-8 text-sm"
          />
          {errors.name ? <span className="text-xs text-danger">{errors.name}</span> : null}
        </Labeled>
        <Labeled label={ui.customFields.dialog.hint}>
          <Textarea
            value={draft.hint}
            maxLength={300}
            disabled={disabled}
            rows={2}
            placeholder={ui.customFields.dialog.hintPlaceholder}
            onChange={(e) => onChange({ hint: e.target.value })}
            className="resize-none text-sm"
          />
        </Labeled>
        {/* «Типы» (#432, В2): у задач и писем — обязательный выбор, у
            проектов и контрагентов поля нет (компонент вернёт null).
            У папок (#556) — сводка видов, которые держат атрибут в форме. */}
        {scope === 'node' ? (
          <NodeKindsSummary fieldId={definition?.id} />
        ) : (
          <FieldTypesPicker
            scope={scope}
            typeIds={draft.typeIds}
            disabled={disabled}
            onChange={(typeIds) => onChange({ typeIds })}
          />
        )}
      </Section>
      {/* Настройки типа и видимость — в две колонки: правый столбец окна
          широкий, а так форма списка с вариантами помещается без прокрутки
          (вердикт 25.10.2026 — «скроллов, которых можно избежать»). */}
      {family ? (
        <div className={cn('grid gap-5', hasSettings && 'grid-cols-2')}>
          {hasSettings ? (
            <Section label={ui.customFields.dialog.settings}>
              <FieldSettings
                family={family}
                settings={draft.settings}
                modifier={draft.modifier}
                modifierLocked={savedModifier}
                disabled={disabled}
                onSettingsChange={(settings) => onChange({ settings })}
                onModifierChange={(modifier) => onChange({ modifier })}
              />
            </Section>
          ) : null}
          <Section label={ui.customFields.dialog.visibility}>
            <SettingRow
              label={ui.customFields.dialog.hidden}
              hint={ui.customFields.dialog.hiddenHint}
            >
              <Switch
                checked={draft.hidden}
                disabled={disabled}
                aria-label={ui.customFields.dialog.hidden}
                onCheckedChange={(hidden) => onChange({ hidden })}
              />
            </SettingRow>
            <SettingRow
              label={ui.customFields.dialog.reportIndexed}
              hint={ui.customFields.dialog.reportIndexedHint}
            >
              <Switch
                checked={draft.reportIndexed}
                disabled={disabled}
                aria-label={ui.customFields.dialog.reportIndexed}
                onCheckedChange={(reportIndexed) => onChange({ reportIndexed })}
              />
            </SettingRow>
          </Section>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{ui.customFields.dialog.pickType}</p>
      )}

      {list ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <NodeLabel label={ui.customFields.dialog.options} />
            <span className="text-label-sm text-muted-foreground">
              {ui.customFields.dialog.optionDefault}
            </span>
          </div>
          {shared ? (
            <p className="text-xs text-muted-foreground">{ui.customFields.dialog.optionsShared}</p>
          ) : null}
          {optionsReadOnly ? (
            <p className="text-xs text-muted-foreground">
              {ui.customFields.dialog.dictionaryReadOnly}
            </p>
          ) : null}
          <FieldOptionsEditor
            options={draft.options}
            defaultIds={draft.defaultOptionIds}
            multiple={type === 'multienum'}
            disabled={disabled || optionsReadOnly}
            onChange={(options) => onChange({ options })}
            onDefaultChange={(defaultOptionIds) => onChange({ defaultOptionIds })}
          />
          {errors.options ? <p className="text-xs text-danger">{errors.options}</p> : null}
          {removedOptions > 0 ? (
            <p className="text-xs text-muted-foreground">
              {ui.customFields.dialog.optionsDeleteHint}
            </p>
          ) : null}
          {issues.includes('optionsDuplicate') ? (
            <p className="text-xs text-danger">{ui.customFields.dialog.optionsDuplicate}</p>
          ) : draft.options.length === 0 ? (
            <p className="text-xs text-muted-foreground">{ui.customFields.dialog.optionsEmpty}</p>
          ) : null}
        </section>
      ) : null}

      {family && !list && preview ? (
        <Section label={ui.customFields.dialog.defaultValue}>
          <FieldDefaultValue
            // Ремоунт при смене типа: редактор прежнего типа не держит
            // чужое значение.
            key={type ?? ''}
            definition={preview}
            value={draft.defaultValue}
            refs={draft.defaultRefs}
            mode={draft.defaultMode}
            disabled={disabled}
            onModeChange={(defaultMode) => onChange({ defaultMode })}
            onChange={(defaultValue, defaultRefs) => onChange({ defaultValue, defaultRefs })}
          />
        </Section>
      ) : null}
    </div>
  );
}
