import type { ReactNode } from 'react';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { EMPTY_CUSTOM_FIELD_BINDINGS, ui } from '@nodus/contracts';
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
import { CustomFieldEditor } from '../../../../shared/custom-fields/value-editor.js';
import { FieldDefaultValue } from './field-default-value.js';
import { FieldOptionsEditor } from './field-options-editor.js';
import { FieldSettings, SettingRow } from './field-settings.js';
import { FieldUsagePicker } from './field-usage-picker.js';

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

/** Радиострока вида использования (Р7): атрибут записей / глобальная. */
function KindOption({
  title,
  hint,
  on,
  disabled,
  onSelect,
}: {
  title: string;
  hint: string;
  on: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
        on ? 'border-primary/50 bg-accent/40' : 'border-input hover:bg-accent/25',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          on ? 'border-primary' : 'border-input',
        )}
      >
        {on ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-foreground">{title}</span>
        <span className="text-xs break-words text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

/**
 * Правая колонка окна атрибута (#631): «Основное» (название, подсказка),
 * «Вид использования» (атрибут записей с «Где используется» / глобальная
 * переменная со значением), «Настройки» типа, «Варианты» списка,
 * «Значение по умолчанию», «Отчёты». Секции разделяются отступами, не
 * линиями (канон сепараторов). Тип не выбран — честная заглушка на месте
 * формы (высота окна не меняется).
 */
export function FieldDialogForm({
  draft,
  definition,
  shared,
  disabled,
  optionsReadOnly,
  errors,
  issues,
  currencyFallback,
  removedOptions,
  suggestion,
  onOpenSuggestion,
  onChange,
}: {
  draft: FieldDraft | null;
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
  /** Дубль имени: существующий атрибут, предлагаемый к открытию (В3). */
  suggestion: { definitionId: string; name: string } | null;
  onOpenSuggestion: (definitionId: string) => void;
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
  const preview = draftDefinition(draft, currencyFallback);
  const savedModifier = definition !== null && modifierOf(definition.type) !== null;
  const hasSettings =
    family !== null &&
    (familyModifier(family) !== null || family === 'number' || family === 'money');
  const kindLocked = definition !== null && definition.isCompany;

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
          {suggestion ? (
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
              {ui.customFields.dialog.nameTaken}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onOpenSuggestion(suggestion.definitionId)}
                className="font-medium text-info underline-offset-2 hover:underline"
              >
                {ui.customFields.dialog.openExisting}
              </button>
            </span>
          ) : null}
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
      </Section>

      <Section label={ui.customFields.dialog.kind}>
        <div className="flex flex-col gap-1.5">
          <KindOption
            title={ui.customFields.dialog.kindRecord}
            hint={ui.customFields.dialog.kindRecordHint}
            on={!draft.isCompany}
            disabled={disabled || kindLocked}
            onSelect={() => onChange({ isCompany: false })}
          />
          <KindOption
            title={ui.customFields.dialog.kindCompany}
            hint={ui.customFields.dialog.kindCompanyHint}
            on={draft.isCompany}
            disabled={disabled || kindLocked}
            onSelect={() => onChange({ isCompany: true, bindings: EMPTY_CUSTOM_FIELD_BINDINGS })}
          />
        </div>
        {draft.isCompany
          ? preview && (
              <Labeled label={ui.customFields.dialog.companyValue}>
                <div className="rounded-lg border border-input bg-muted/30 px-2.5 py-1.5">
                  <CustomFieldEditor
                    definition={preview}
                    value={draft.companyValue ?? undefined}
                    refs={[]}
                    disabled={disabled}
                    variant="form"
                    onCommit={(value) => onChange({ companyValue: value })}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {ui.customFields.dialog.companyValueHint}
                </span>
              </Labeled>
            )
          : null}
      </Section>

      {!draft.isCompany ? (
        <Section label={ui.customFields.bind.field}>
          <FieldUsagePicker
            bindings={draft.bindings}
            disabled={disabled}
            onChange={(bindings) => onChange({ bindings })}
          />
        </Section>
      ) : null}

      {family ? (
        <div className={cn('grid gap-5', hasSettings && !draft.isCompany && 'grid-cols-2')}>
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
            disabled={disabled}
            optionsReadOnly={optionsReadOnly}
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

      {family && !list && !draft.isCompany && preview ? (
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
