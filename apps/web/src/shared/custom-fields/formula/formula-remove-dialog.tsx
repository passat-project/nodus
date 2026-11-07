import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';

/**
 * Подтверждение снятия формулы (#632, Р5): удаление формулы — осознанное
 * действие, а не случайный Enter в ячейке. Значение остаётся снимком, но
 * пересчёт прекращается — окно объясняет последствие до нажатия.
 */
export function FormulaRemoveDialog({
  open,
  pending,
  overlay = true,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  /** false — окно поверх редактора формулы (вложенный лист). */
  overlay?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-md" showCloseButton={false} overlay={overlay}>
        <DialogHeader>
          <DialogTitle>{ui.formulas.cell.removeTitle}</DialogTitle>
          <DialogDescription>{ui.formulas.cell.removeHint}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {ui.formulas.editor.cancel}
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {ui.formulas.cell.removeConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
