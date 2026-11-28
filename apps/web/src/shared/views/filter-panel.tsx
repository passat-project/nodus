import { Check, Pin, PinOff, Plus, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { listsStrings, ui } from '@nodus/contracts';
import type { SavedView } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { FilterCombobox } from './filter-combobox.js';
import {
  FilterPanelExportButton,
  FilterPanelSavedViews,
  FilterPanelSaveView,
} from './filter-panel-ext.js';
import { NumberRangeControl } from './filter-number-range.js';
import type { DateRangeValue, FilterFieldDef, FilterValue } from './list-filters.js';
import { sameFilterState } from './list-filters.js';
import type { FilterPreset, ListToolbarState } from './use-list-toolbar.js';

/** Расширение панели списков (#435): секции группировки/итогов, сохранённые
 *  виды, «Выгрузить CSV». Всё опционально — журналы без расширения работают
 *  как раньше. */
export interface FilterPanelExt {
  /** Секции «Группировка» и «Итоги» (state + варианты полей). */
  sections: ReactNode;
  /** Сохранённые виды рамки (левая колонка, под пресетами). */
  savedViews?: {
    views: readonly SavedView[];
    activeViewId?: string;
    onApply: (view: SavedView) => void;
    onDelete: (view: SavedView) => void;
  };
  /** «Сохранить как вид» (имя спрашивает панель). */
  onSaveView?: (name: string) => void;
  /** «Выгрузить CSV» — текущая выборка и колонки. */
  onExportCsv?: () => void;
  /** Значения фильтра удалённых атрибутов (пометка «удалён», не шлются). */
  removedFieldIds?: readonly string[];
  /** Сброс расширения вместе с фильтрами («Сбросить»). */
  onReset?: () => void;
}

/**
 * Панель фильтра списка (модель Битрикс24): выезжает ИЗ поисковой строки
 * (отдельной кнопки «Фильтр» нет). Слева — колонка ПРЕСЕТОВ (встроенные +
 * сохранённые): быстрое применение кликом, активный подсвечен, «скрепка»
 * закрепляет пресет по умолчанию, свои можно удалять; внизу — «Сохранить
 * фильтр» (#435: и «Сохранить как вид»). Справа — поля фильтра по атрибутам
 * из реестра (применение мгновенное, оптимистичный UI), секции группировки
 * и итогов (#435), «Сбросить» и «Выгрузить CSV». Скрытые служебные поля
 * (hidden — напр. «Просроченные») в панель не выводятся.
 */
export function FilterPanel<T>({
  toolbar,
  defs,
  builtinPresets,
  ext,
}: {
  toolbar: ListToolbarState;
  defs: FilterFieldDef<T>[];
  builtinPresets: FilterPreset[];
  ext?: FilterPanelExt;
}) {
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState('');
  const visibleDefs = defs.filter((d) => !d.hidden);
  const allPresets = [...builtinPresets, ...toolbar.presets];

  function submitPreset() {
    const name = presetName.trim();
    if (!name) return;
    toolbar.savePreset(name);
    setPresetName('');
    setNaming(false);
  }

  return (
    <div className="flex max-h-[var(--radix-popover-content-available-height)] min-h-0">
      {/* Левая колонка — пресеты: быстрое применение (модель Битрикс24).
          Зона отделена тоном (bg-muted/40) и кеглем 13px — единым с подписями
          полей справа, чтобы колонки читались одним приложением. #435: под
          пресетами — сохранённые виды (та же механика применения), внизу —
          «Сохранить фильтр» и «Сохранить как вид». */}
      <div className="flex w-44 shrink-0 flex-col overflow-y-auto border-r border-border bg-muted/40 py-1.5">
        {allPresets.map((preset) => {
          const active = sameFilterState(toolbar.filters, preset.state);
          const pinned = toolbar.pinnedId === preset.id;
          const isBuiltin = builtinPresets.some((b) => b.id === preset.id);
          return (
            <div
              key={preset.id}
              className={cn(
                'group mx-1.5 flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent/60',
                active && 'bg-accent',
              )}
            >
              <button
                type="button"
                onClick={() => toolbar.setFilters(preset.state)}
                title={preset.name}
                className={cn(
                  'min-w-0 flex-1 truncate text-left text-body-xs leading-5',
                  active ? 'font-medium text-foreground' : 'text-secondary-foreground',
                )}
              >
                {preset.name}
              </button>
              <button
                type="button"
                onClick={() => toolbar.togglePin(preset.id)}
                aria-label={pinned ? ui.filters.unpin : ui.filters.pin}
                title={pinned ? ui.filters.unpin : ui.filters.pin}
                className={cn(
                  'shrink-0 rounded p-1 transition-opacity',
                  pinned
                    ? 'text-port'
                    : 'text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                )}
              >
                {pinned ? (
                  <PinOff className="size-3" strokeWidth={1.75} />
                ) : (
                  <Pin className="size-3" strokeWidth={1.75} />
                )}
              </button>
              {isBuiltin ? null : (
                <button
                  type="button"
                  onClick={() => toolbar.deletePreset(preset.id)}
                  aria-label={ui.filters.deletePreset}
                  className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger"
                >
                  <Trash2 className="size-3" strokeWidth={1.75} />
                </button>
              )}
            </div>
          );
        })}
        {ext?.savedViews ? (
          <FilterPanelSavedViews
            views={ext.savedViews.views}
            activeViewId={ext.savedViews.activeViewId}
            onApply={ext.savedViews.onApply}
            onDelete={ext.savedViews.onDelete}
          />
        ) : null}
        <div className="mt-1 px-1.5 pt-1.5">
          {naming ? (
            <div className="flex items-center gap-1 px-1.5">
              <Input
                autoFocus
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitPreset();
                  }
                  if (e.key === 'Escape') setNaming(false);
                }}
                placeholder={ui.filters.savePlaceholder}
                className="h-7 text-sm"
              />
              <Button
                size="sm"
                className="size-7 shrink-0 p-0"
                disabled={!presetName.trim()}
                onClick={submitPreset}
                aria-label={ui.filters.save}
              >
                <Check className="size-3.5" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNaming(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-body-xs leading-5 text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
              {ui.filters.save}
            </button>
          )}
          {ext?.onSaveView ? <FilterPanelSaveView onSave={ext.onSaveView} /> : null}
        </div>
      </div>

      {/* Правая колонка — поля фильтра по атрибутам (мгновенное применение).
          Поля с группой идут подряд под моно-заголовком (атрибуты — «Атрибуты», #431);
          #435: значения удалённых атрибутов помечены, секции группировки/итогов —
          после полей, внизу — «Сбросить» и «Выгрузить CSV». */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        {visibleDefs.map((def, index) => {
          const newGroup = def.group !== undefined && def.group !== visibleDefs[index - 1]?.group;
          return (
            <div key={def.id} className="flex flex-col gap-2.5">
              {newGroup ? <NodeLabel label={def.group!} className="pt-1" /> : null}
              <FilterFieldControl
                def={def}
                value={toolbar.filters[def.id]}
                onChange={(v) => toolbar.setFilter(def.id, v)}
              />
            </div>
          );
        })}
        {(ext?.removedFieldIds?.length ?? 0) > 0 ? (
          <>
            <NodeLabel label={ui.filters.groupFields} className="pt-1" />
            {ext!.removedFieldIds!.map((fieldId) => (
              <div key={fieldId} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-body-xs text-muted-foreground/70 line-through">
                  {listsStrings.removedFieldLabel}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1 rounded-md bg-accent/60 px-1.5 py-0.5 text-xs text-muted-foreground">
                  <span className="truncate">{listsStrings.removedFieldLabel}</span>
                  <button
                    type="button"
                    onClick={() => toolbar.setFilter(fieldId, undefined)}
                    aria-label={`${ui.filters.reset}: ${listsStrings.removedFieldLabel}`}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" strokeWidth={1.75} />
                  </button>
                </span>
              </div>
            ))}
          </>
        ) : null}
        {ext?.sections}
        <div className="flex items-center gap-2 pt-2.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => {
              toolbar.resetAll();
              ext?.onReset?.();
            }}
          >
            {ui.filters.reset}
          </Button>
          {ext?.onExportCsv ? <FilterPanelExportButton onExport={ext.onExportCsv} /> : null}
        </div>
      </div>
    </div>
  );
}

/** Контрол одного поля фильтра по его типу: справочники — комбобокс с
 *  подсказками (модель Битрикс24), даты — диапазон, строка — инпут. */
function FilterFieldControl<T>({
  def,
  value,
  onChange,
}: {
  def: FilterFieldDef<T>;
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  if (def.type === 'select' || def.type === 'person') {
    return (
      <label className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-body-xs text-muted-foreground">{def.label}</span>
        <FilterCombobox
          options={def.options ?? []}
          value={typeof value === 'string' ? value : undefined}
          onChange={(v) => onChange(v)}
          ariaLabel={def.label}
        />
      </label>
    );
  }
  if (def.type === 'dateRange') {
    const range: DateRangeValue =
      typeof value === 'object' && value !== undefined ? (value as DateRangeValue) : {};
    return (
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-body-xs text-muted-foreground">{def.label}</span>
        <Input
          type="date"
          aria-label={`${def.label}: ${ui.filters.dateFrom}`}
          value={range.from ?? ''}
          onChange={(e) => onChange({ ...range, from: e.target.value || undefined })}
          className="h-8 flex-1 text-sm"
        />
        <Input
          type="date"
          aria-label={`${def.label}: ${ui.filters.dateTo}`}
          value={range.to ?? ''}
          onChange={(e) => onChange({ ...range, to: e.target.value || undefined })}
          className="h-8 flex-1 text-sm"
        />
      </div>
    );
  }
  if (def.type === 'numberRange') {
    return <NumberRangeControl def={def} value={value} onChange={onChange} />;
  }
  return (
    <label className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-body-xs text-muted-foreground">{def.label}</span>
      <Input
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder={def.placeholder}
        className="h-8 flex-1 text-sm"
      />
    </label>
  );
}
