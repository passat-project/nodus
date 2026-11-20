import { useState } from 'react';
import type { Position } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';

import { ReferenceCombobox } from './reference-combobox.js';

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
            <ReferenceCombobox
              value={targetId}
              onChange={setTargetId}
              options={targets.map((target) => ({ id: target.id, label: target.name }))}
              ariaLabel={ui.employees.positionReassignTarget}
              placeholder={ui.employees.positionReassignSearch}
              // Обязательный выбор: «Не выбрано» тут — пустое действие.
              allowClear={false}
            />
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
