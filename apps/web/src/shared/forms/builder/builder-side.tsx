import type { LockEditors } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Lock, Plus, X } from 'lucide-react';

import { SegmentedControl } from '../../ui/segmented-control.js';
import { fieldGroups, type FormBuilderHost } from './builder-host.js';
import {
  availableOf,
  fieldCount,
  isBuilderBlock,
  isBuilderField,
  setLock,
  type BuilderValue,
} from './builder-model.js';

const b = ui.forms.builder;
const l = ui.forms.locks;

/**
 * Под окном в редакторе (#496): лоток «Поля, которых нет в окне» (клик —
 * в конец окна) и «Закрепить также» — замки полей вне окна (В9: окно
 * кнопки закрепляет и то, чего не спрашивает).
 */
export function BuilderTray<X>({
  value,
  host,
  onChange,
}: {
  value: BuilderValue<X>;
  host: FormBuilderHost<X>;
  onChange: (next: BuilderValue<X>) => void;
}) {
  const full = fieldCount(value.items) >= host.limits.fields;
  const available = availableOf(host.catalog, value.items);
  const blocks = (host.blocks ?? []).filter(
    (option) => !value.items.some((item) => isBuilderBlock(item) && item.block === option.block),
  );
  // Системные поля и свои атрибуты — разными группами: настройщик видит, что
  // пришло с сущностью, а что создано в справочнике (#496, 08.11.2026).
  const groups = fieldGroups(available);
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-muted/40 p-4">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{b.tray}</h3>
        {host.onCreateField ? (
          <Button type="button" variant="ghost" size="xs" onClick={host.onCreateField}>
            <Plus className="size-3" strokeWidth={2} />
            {b.createField}
          </Button>
        ) : null}
      </div>
      {available.length === 0 && blocks.length === 0 ? (
        <p className="text-xs text-muted-foreground">{b.trayEmpty}</p>
      ) : (
        <>
          {groups.map((group) => (
            <div key={group.label ?? 'fields'} className="flex flex-col gap-1.5">
              {/* Подпись группы — когда полей и блоков несколько категорий:
                  иначе лишний шум (вердикт владельца 08.11.2026). */}
              {group.label ? (
                <p className="text-label-xs text-muted-foreground">{group.label}</p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {group.options.map((option) => (
                  <Button
                    key={option.key}
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={full}
                    title={full ? b.fieldsLimit : undefined}
                    onClick={() =>
                      onChange({ ...value, items: [...value.items, host.makeField(option.key)] })
                    }
                  >
                    <Plus className="size-3" strokeWidth={2} />
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          {blocks.length > 0 && host.makeBlock ? (
            <div className="flex flex-col gap-1.5">
              {available.length > 0 ? (
                <p className="text-label-xs text-muted-foreground">{b.insertBlocks}</p>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {blocks.map((option) => (
                  <Button
                    key={option.block}
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      onChange({ ...value, items: [...value.items, host.makeBlock!(option.block)] })
                    }
                  >
                    <Plus className="size-3" strokeWidth={2} />
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export function BuilderAlsoLocks<X>({
  value,
  host,
  readOnly,
  onChange,
}: {
  value: BuilderValue<X>;
  host: FormBuilderHost<X>;
  readOnly: boolean;
  onChange: (next: BuilderValue<X>) => void;
}) {
  const inWindow = new Set(value.items.filter(isBuilderField).map((field) => field.key));
  const extra = value.locks.filter((lock) => !inWindow.has(lock.key));
  const options = (host.lockable ?? []).filter(
    (option) => !inWindow.has(option.key) && !value.locks.some((lock) => lock.key === option.key),
  );
  const update = (key: string, editors: LockEditors | null) =>
    onChange({ ...value, locks: setLock(value.locks, key, editors) });

  return (
    <section className="flex flex-col gap-2 rounded-xl bg-muted/40 p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        <Lock className="size-3.5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        {l.also}
      </h3>
      <p className="text-xs text-muted-foreground">{l.alsoHint}</p>
      {extra.length === 0 && readOnly ? (
        <p className="text-sm text-muted-foreground">{l.alsoNone}</p>
      ) : null}
      {extra.map((lock) => (
        <div key={lock.key} className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm">{host.info(lock.key).label}</span>
          <SegmentedControl<LockEditors>
            value={lock.editors}
            disabled={readOnly}
            size="sm"
            ariaLabel={l.also}
            className="w-56 shrink-0"
            options={[
              { value: 'none', label: l.none },
              { value: 'owners', label: l.owners },
            ]}
            onChange={(editors) => update(lock.key, editors)}
          />
          {readOnly ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label={l.removeLock}
              title={l.removeLock}
              onClick={() => update(lock.key, null)}
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </Button>
          )}
        </div>
      ))}
      {!readOnly && options.length > 0 ? (
        <Select value="" onValueChange={(key) => update(key, 'none')}>
          <SelectTrigger className="h-8 w-full max-w-64" aria-label={l.alsoAdd}>
            <SelectValue placeholder={l.alsoAdd} />
          </SelectTrigger>
          <SelectContent position="popper">
            {options.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </section>
  );
}
