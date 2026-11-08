import type { FormHeight, LockEditors } from '@nodus/contracts';
import { FORM_LAYOUT_LIMITS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { Trash2 } from 'lucide-react';

import { PanelField } from '../../ui/panel/panel-kit.js';
import { SegmentedControl } from '../../ui/segmented-control.js';
import type { BuilderFieldInfo, FormBuilderHost } from './builder-host.js';
import type { BuilderField, FieldPatch } from './builder-model.js';

const b = ui.forms.builder;
const l = ui.forms.locks;

const HEIGHTS: readonly FormHeight[] = ['line', 'lines', 'large'];
type LockChoice = 'off' | LockEditors;

/**
 * Настройки поля окна (#496): подпись в окне, подсказка, высота текста,
 * замок «после создания / после нажатия» и своё хоста. Всё правит черновик
 * редактора — на сервер уходит по «Готово» одним шагом.
 */
export function BuilderFieldSettings<X>({
  field,
  info,
  host,
  lock,
  readOnly,
  onPatch,
  onLock,
  onRemove,
}: {
  field: BuilderField<X>;
  info: BuilderFieldInfo;
  host: FormBuilderHost<X>;
  lock: LockEditors | null;
  readOnly: boolean;
  onPatch: (patch: FieldPatch<X>) => void;
  onLock: (editors: LockEditors | null) => void;
  onRemove: () => void;
}) {
  if (info.unknown) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">{b.unknownField}</p>
        <p className="text-xs text-muted-foreground">{b.unknownFieldHint}</p>
        {readOnly ? null : <RemoveButton onClick={onRemove} />}
      </div>
    );
  }
  const lockable = host.lockMode !== null && info.lockable === true;
  return (
    <div className="flex flex-col gap-3">
      <PanelField label={b.label} hint={b.labelHint}>
        <Input
          value={field.label ?? ''}
          maxLength={60}
          readOnly={readOnly}
          placeholder={info.label}
          aria-label={b.label}
          onChange={(event) => onPatch({ label: event.target.value })}
        />
      </PanelField>
      <PanelField label={b.hint}>
        <Input
          value={field.hint ?? ''}
          maxLength={FORM_LAYOUT_LIMITS.hint}
          readOnly={readOnly}
          placeholder={b.hintPlaceholder}
          aria-label={b.hint}
          onChange={(event) => onPatch({ hint: event.target.value })}
        />
      </PanelField>
      {info.multiline ? (
        <PanelField label={b.height}>
          <SegmentedControl<FormHeight>
            value={field.height ?? 'lines'}
            disabled={readOnly}
            layout="grid"
            className="w-full"
            options={HEIGHTS.map((height) => ({ value: height, label: b.heights[height] }))}
            onChange={(height) => onPatch({ height })}
          />
        </PanelField>
      ) : null}
      {lockable ? (
        <PanelField
          label={host.lockMode === 'creation' ? l.afterCreation : l.afterTransition}
          hint={lockHint(lock, host.lockMode)}
        >
          <SegmentedControl<LockChoice>
            value={lock ?? 'off'}
            disabled={readOnly}
            layout="grid"
            className="w-full"
            options={[
              { value: 'off', label: l.off },
              { value: 'none', label: l.none },
              { value: 'owners', label: l.owners },
            ]}
            onChange={(choice) => onLock(choice === 'off' ? null : choice)}
          />
        </PanelField>
      ) : null}
      {host.settings?.(field, onPatch)}
      {readOnly || info.fixed ? null : <RemoveButton onClick={onRemove} />}
      {info.fixed ? <p className="text-xs text-muted-foreground">{b.systemRow}</p> : null}
    </div>
  );
}

function lockHint(lock: LockEditors | null, mode: FormBuilderHost<unknown>['lockMode']) {
  const base = lock === 'none' ? l.noneHint : lock === 'owners' ? l.ownersHint : undefined;
  if (mode !== 'transition') return base;
  return base ? `${base}. ${l.transitionHint}` : l.transitionHint;
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="self-start text-danger hover:text-danger"
      onClick={onClick}
    >
      <Trash2 className="size-3.5" strokeWidth={1.75} />
      {b.remove}
    </Button>
  );
}
