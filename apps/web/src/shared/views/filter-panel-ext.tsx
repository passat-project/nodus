import { BookMarked, Download, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { ui } from '@nodus/contracts';
import type { ListField, ListTotal, SavedView } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { FilterCombobox } from './filter-combobox.js';
import type { ListFieldOption } from './list-ext/list-field-options.js';
import type { ListExtState } from './list-ext/use-list-ext.js';

/**
 * Секции расширения панели фильтра (#435): группировка, итоги, сохранённые
 * виды и «Выгрузить CSV». Грамматика — та же, что у полей фильтра: моно-заголовки
 * секций (NodeLabel, как «Атрибуты»), справочники — комбобоксом с подсказками
 * и select'ом конструктора условий (#635), применение мгновенное. Сохранённые
 * виды — в левой колонке пресетов панели (НЕ отдельный список видов): клик
 * применяет, корзина удаляет.
 */

/** Итог: агрегат + поле (count — без поля). */
function TotalRow({
  total,
  fields,
  onChange,
  onRemove,
}: {
  total: ListTotal;
  fields: readonly ListFieldOption[];
  onChange: (total: ListTotal) => void;
  onRemove: () => void;
}) {
  const t = ui.lists.panel;
  const fnValue = total.fn;
  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={fnValue}
        onValueChange={(fn) => {
          if (fn === 'count') onChange({ fn });
          else onChange({ fn: fn as 'sum' | 'min' | 'max', field: fieldOf(fields[0]?.value) });
        }}
      >
        <SelectTrigger aria-label={t.totals} className="h-8 w-28 shrink-0 min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="count">{t.totalCount}</SelectItem>
          <SelectItem value="sum">{t.sum}</SelectItem>
          <SelectItem value="min">{t.min}</SelectItem>
          <SelectItem value="max">{t.max}</SelectItem>
        </SelectContent>
      </Select>
      {total.fn === 'count' ? (
        <span className="min-w-0 flex-1" />
      ) : (
        <div className="min-w-0 flex-1">
          <FilterCombobox
            options={fields.map((f) => ({ value: f.value, label: f.label }))}
            value={total.field}
            onChange={(v) => v && onChange({ fn: total.fn, field: fieldOf(v) })}
            ariaLabel={t.totalValue}
          />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={ui.common.remove}
        className="shrink-0 rounded p-1 text-muted-foreground hover:text-danger"
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

/** Поле итога из варианта панели (валидацию типа делает сервер). */
function fieldOf(value: string | undefined): ListField {
  return (value ?? '') as ListField;
}

/** Секции справа: группировка + итоги. */
export function FilterPanelExtSections({
  state,
  groupFields,
  numericFields,
}: {
  state: ListExtState;
  groupFields: readonly ListFieldOption[];
  numericFields: readonly ListFieldOption[];
}) {
  const t = ui.lists.panel;
  const addTotal = () => {
    const next: ListTotal[] = [...state.totals, { fn: 'count' }];
    state.setTotals(next);
  };
  return (
    <>
      <NodeLabel label={t.groupBy} className="pt-1" />
      <div>
        <FilterCombobox
          options={[
            { value: '', label: t.groupNone },
            ...groupFields.map((f) => ({ value: f.value, label: f.label })),
          ]}
          value={state.group?.field}
          onChange={(v) => state.setGroup(v ? { field: v as ListField } : undefined)}
          ariaLabel={t.groupBy}
        />
      </div>
      <NodeLabel label={t.totals} className="pt-1" />
      {state.totals.map((total, index) => (
        <TotalRow
          key={index}
          total={total}
          fields={numericFields}
          onChange={(next) =>
            state.setTotals(state.totals.map((item, i) => (i === index ? next : item)))
          }
          onRemove={() => state.setTotals(state.totals.filter((_, i) => i !== index))}
        />
      ))}
      <button
        type="button"
        onClick={addTotal}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-body-xs leading-5 text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3.5" strokeWidth={1.75} />
        {t.addTotal}
      </button>
    </>
  );
}

/** Левая колонка: сохранённые виды (применение кликом, удаление корзиной). */
export function FilterPanelSavedViews({
  views,
  activeViewId,
  onApply,
  onDelete,
}: {
  views: readonly SavedView[];
  activeViewId?: string;
  onApply: (view: SavedView) => void;
  onDelete: (view: SavedView) => void;
}) {
  const t = ui.lists.panel;
  if (views.length === 0) return null;
  return (
    <>
      <NodeLabel label={t.savedViews} className="mx-1.5 mt-2" />
      {views.map((view) => (
        <div
          key={view.id}
          className={`group mx-1.5 flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent/60 ${
            activeViewId === view.id ? 'bg-accent' : ''
          }`}
        >
          <BookMarked
            className="size-3 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => onApply(view)}
            title={view.name}
            className="min-w-0 flex-1 truncate text-left text-body-xs leading-5 text-secondary-foreground"
          >
            {view.name}
          </button>
          <button
            type="button"
            onClick={() => onDelete(view)}
            aria-label={t.deleteView}
            title={t.deleteView}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger"
          >
            <Trash2 className="size-3" strokeWidth={1.75} />
          </button>
        </div>
      ))}
    </>
  );
}

/** Именование и сохранение вида (внизу левой колонки, рядом с «Сохранить
 *  фильтр»): имя + уровень задаёт потребитель (журнал — личный). */
export function FilterPanelSaveView({ onSave }: { onSave: (name: string) => void }) {
  const t = ui.lists.panel;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName('');
    setNaming(false);
  };
  if (!naming) {
    return (
      <button
        type="button"
        onClick={() => setNaming(true)}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-body-xs leading-5 text-muted-foreground hover:text-foreground"
      >
        <BookMarked className="size-3.5" strokeWidth={1.75} />
        {t.saveView}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 px-1.5">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') setNaming(false);
        }}
        placeholder={t.viewNamePlaceholder}
        className="h-7 text-sm"
      />
      <Button
        size="sm"
        className="size-7 shrink-0 p-0"
        disabled={!name.trim()}
        onClick={submit}
        aria-label={t.saveView}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

/** Строка «Выгрузить CSV» (действие панели — текущая выборка и колонки). */
export function FilterPanelExportButton({ onExport }: { onExport: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onExport}>
      <Download data-icon="inline-start" />
      {ui.lists.panel.exportCsv}
    </Button>
  );
}
