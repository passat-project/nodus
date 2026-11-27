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
import { Lock, X } from 'lucide-react';

import { SegmentedControl } from '../../ui/segmented-control.js';
import type { FormBuilderHost } from './builder-host.js';
import { isBuilderField, setLock, type BuilderValue } from './builder-model.js';

const l = ui.forms.locks;

/**
 * «Закрепить также» — замки полей ВНЕ окна (В9: окно кнопки закрепляет и
 * то, чего не спрашивает). В окне перехода живёт лотком под листом, во
 * вкладке «Форма создания» (ревизия 27.11) — блоком левой колонки под
 * палитрой.
 */
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
