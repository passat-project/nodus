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
import { KindOption } from './field-kind-option.js';
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
  // Вид использования фиксируется при создании: PATCH не меняет isCompany,
  // а переключение записи в глобальную молча сняло бы привязки и не сохранило
  // значение (#646). Для нового атрибута выбор доступен.
  const kindLocked = definition !== null;

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
        <div
          className="flex flex-col gap-1.5"
          role="radiogroup"
          aria-label={ui.customFields.dialog.kind}
        >
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
            onSelect={() =>
              onChange({
                isCompany: true,
                bindings: EMPTY_CUSTOM_FIELD_BINDINGS,
                defaultMode: 'none',
                defaultValue: null,
                defaultRefs: [],
                defaultOptionIds: [],
              })
            }
          />
        </div>
        {draft.isCompany
          ? preview &&
            (definition === null && isListFamily(draft.family) ? (
              // Варианты списка создаются вместе с атрибутом — до сохранения
              // серверных id нет, выбирать не из чего (#646).
              <p className="text-xs text-muted-foreground">
                {ui.customFields.dialog.companyValueAfterSave}
              </p>
            ) : (
              <Labeled label={ui.customFields.dialog.companyValue}>
                {/* Редактор form-варианта — сам контрол с рамкой: обёртка
                    давала двойной бордюр (рамка в рамке). У существующего
                    атрибута берём настоящее определение (справочник и имена
                    ссылок), у нового — черновик. */}
                <CustomFieldEditor
                  definition={definition ?? preview}
                  value={draft.companyValue ?? undefined}
                  refs={(definition ?? preview).companyRefs ?? []}
                  disabled={disabled}
                  variant="form"
                  onCommit={(value) => onChange({ companyValue: value })}
                />
              </Labeled>
            ))
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
