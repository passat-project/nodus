import { useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { Position } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverAnchor, PopoverContent } from '@nodus/ui/components/popover';

/**
 * Выбор целевой должности автокомплитом (#768, вердикт 13.11.2026): поле с
 * вводом фильтрует список с клавиатуры, список раскрывается ТОЛЬКО ВНИЗ
 * (`side="bottom"`, авто-переворот Radix отключён) и ограничен высотой с
 * прокруткой. Radix Select в диалоге переворачивался вверх и не давал поиска.
 */
function PositionCombobox({
  value,
  targets,
  onChange,
}: {
  value: string | null;
  targets: readonly Position[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const fromPointer = useRef(false);
  // Гард указательного устройства для ТРИГГЕРА: focus приходит на mousedown,
  // слой монтируется между pointerdown и click — завершающий click той же мыши
  // дисмиссит поповер (gotcha frontend «Radix Popover из фокуса»). Канон:
  // мышь открывает по onClick, клавиатура — по onFocus без указательного флага.
  const triggerPointer = useRef(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const selected = targets.find((target) => target.id === value) ?? null;
  const q = text.trim().toLocaleLowerCase('ru');
  const filtered = q
    ? targets.filter((target) => target.name.toLocaleLowerCase('ru').includes(q))
    : targets;

  function choose(id: string) {
    onChange(id);
    setText('');
    setOpen(false);
    anchorRef.current?.focus();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Указательный гард Radix: клик по варианту не закрывает поповер
        // раньше выбора (pointer-down dismiss).
        if (!next && fromPointer.current) {
          fromPointer.current = false;
          return;
        }
        setOpen(next);
        if (!next) setText('');
      }}
    >
      <div ref={anchorRef} className="relative">
        <PopoverAnchor asChild>
          <Input
            value={open ? text : (selected?.name ?? '')}
            placeholder={ui.employees.positionReassignSearch}
            aria-label={ui.employees.positionReassignTarget}
            onPointerDown={() => {
              triggerPointer.current = true;
            }}
            onChange={(event) => {
              setText(event.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              if (!triggerPointer.current) setOpen(true);
            }}
            onClick={() => {
              triggerPointer.current = false;
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                // Esc закрывает список, а не диалог.
                event.stopPropagation();
                setOpen(false);
                setText('');
                return;
              }
              if (event.key === 'Enter' && open && filtered[0]) {
                event.preventDefault();
                choose(filtered[0].id);
              }
            }}
            className="h-8 text-sm"
          />
        </PopoverAnchor>
      </div>
      <PopoverContent
        align="start"
        side="bottom"
        // Всегда вниз: у поля достаточно места под ним, а переворот вверх в
        // диалоге читался как «список уехал» (вердикт 13.11.2026).
        avoidCollisions={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDown={() => {
          fromPointer.current = true;
        }}
        className="w-(--radix-popover-trigger-width) overflow-hidden p-1"
      >
        <div className="max-h-60 overflow-y-auto">
          {filtered.length === 0 && (
            <span className="block px-2 py-1.5 text-xs text-muted-foreground">
              {ui.filters.notFound}
            </span>
          )}
          {filtered.map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={() => choose(target.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate">{target.name}</span>
              {target.id === value && (
                <Check className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Переназначение сотрудников перед удалением должности (#768): ВСЕ сотрудники,
 * включая уволенных, переходят на другую активную управленческую должность —
 * отдельного архива должностей у уволенных нет. Цель — не та же должность
 * (сервер проверяет повторно).
 */
export function ReassignPositionDialog({
  position,
  holders,
  targets,
  pending,
  onClose,
  onSubmit,
}: {
  position: Position | null;
  holders: number;
  targets: Position[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (targetId: string) => void;
}) {
  const [targetId, setTargetId] = useState<string | null>(null);
  // Новый диалог — чистый выбор цели (рендер-тайм, #45).
  const [prevPositionId, setPrevPositionId] = useState(position?.id ?? null);
  if (prevPositionId !== (position?.id ?? null)) {
    setPrevPositionId(position?.id ?? null);
    setTargetId(null);
  }

  return (
    <Dialog open={position !== null} onOpenChange={(next) => !next && onClose()}>
      {/* Окно-продолжение действия: без fade/zoom на открытии (иначе читается
          «призраком» второй анимации поверх панели, #768). */}
      <DialogContent animateOpen={false} className="w-full bg-card sm:max-w-sm">
        <DialogTitle className="text-base font-semibold text-foreground">
          {ui.employees.positionReassignTitle}
        </DialogTitle>
        {position && <p className="text-sm font-medium text-foreground">{position.name}</p>}
        <p className="font-mono text-label-sm text-muted-foreground tabular-nums">
          {ui.employees.positionReassignCount}: {holders}
        </p>
        {targets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ui.employees.positionReassignNoTarget}</p>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {ui.employees.positionReassignTarget}
            </span>
            <PositionCombobox value={targetId} targets={targets} onChange={setTargetId} />
          </label>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button disabled={!targetId || pending} onClick={() => targetId && onSubmit(targetId)}>
            {ui.employees.positionReassignAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
