import type { FormHeight, LockEditors } from '@nodus/contracts';
import { FORM_LAYOUT_LIMITS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { Trash2 } from 'lucide-react';

import { ModeChoices, PanelField } from '../../ui/panel/panel-kit.js';
import type { BuilderFieldInfo, FormBuilderHost } from './builder-host.js';
import type { BuilderField, FieldPatch } from './builder-model.js';

const b = ui.forms.builder;
const l = ui.forms.locks;

const HEIGHTS: readonly FormHeight[] = ['line', 'lines', 'large'];
type LockChoice = 'off' | LockEditors;

/** Общие настройки элемента окна — поля и блока: своя подпись и подсказка.
 *  Один и тот же блок в настройках всех элементов (#496, единое ядро). */
export function LayoutInputs({
  label,
  hint,
  defaultLabel,
  readOnly,
  showHint = true,
  onChange,
}: {
  label: string | null;
  hint: string | null;
  defaultLabel: string;
  readOnly: boolean;
  /** У строки нет подсказки (системные строки проекта). */
  showHint?: boolean;
  onChange: (patch: { label?: string; hint?: string }) => void;
}) {
  return (
    <>
      <PanelField label={b.label} hint={b.labelHint}>
        <Input
          value={label ?? ''}
          maxLength={60}
          readOnly={readOnly}
          placeholder={defaultLabel}
          aria-label={b.label}
          onChange={(event) => onChange({ label: event.target.value })}
        />
      </PanelField>
      {showHint ? (
        <PanelField label={b.hint}>
          <Input
            value={hint ?? ''}
            maxLength={FORM_LAYOUT_LIMITS.hint}
            readOnly={readOnly}
            placeholder={b.hintPlaceholder}
            aria-label={b.hint}
            onChange={(event) => onChange({ hint: event.target.value })}
          />
        </PanelField>
      ) : null}
    </>
  );
}

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
      {info.hideLayout ? null : (
        <LayoutInputs
          label={field.label}
          hint={field.hint}
          defaultLabel={info.label}
          readOnly={readOnly}
          showHint={!info.hideHint}
          onChange={onPatch}
        />
      )}
      {info.multiline && !info.hideLayout ? (
        <PanelField label={b.height}>
          {/* Строки, а не сегменты: «Несколько строк» в узком сегменте
              обрезалось (замечание владельца 08.11.2026). */}
          <ModeChoices<FormHeight>
            value={field.height ?? 'lines'}
            disabled={readOnly}
            options={HEIGHTS.map((height) => ({
              value: height,
              label: b.heights[height],
              hint: b.heightHints[height],
            }))}
            onChange={(height) => onPatch({ height })}
          />
        </PanelField>
      ) : null}
      {lockable ? (
        <PanelField label={host.lockMode === 'creation' ? l.afterCreation : l.afterTransition}>
          <ModeChoices<LockChoice>
            value={lock ?? 'off'}
            disabled={readOnly}
            options={[
              { value: 'off', label: l.off, hint: l.offHint },
              { value: 'none', label: l.none, hint: l.noneHint },
              { value: 'owners', label: l.owners, hint: ownersHint(host.lockMode) },
            ]}
            onChange={(choice) => onLock(choice === 'off' ? null : choice)}
          />
        </PanelField>
      ) : null}
      {host.settings?.(field, onPatch)}
      {readOnly || info.fixed ? null : <RemoveButton onClick={onRemove} />}
      {info.fixed && !info.hideLayout ? (
        <p className="text-xs text-muted-foreground">{b.systemRow}</p>
      ) : null}
    </div>
  );
}

/** Пояснение «кто меняет»: в окне кнопки к нему добавляется правило про
 *  окно кнопки, которое снова спрашивает поле. */
function ownersHint(mode: FormBuilderHost<unknown>['lockMode']): string {
  return mode === 'transition' ? `${l.ownersHint}. ${l.transitionHint}` : l.ownersHint;
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
