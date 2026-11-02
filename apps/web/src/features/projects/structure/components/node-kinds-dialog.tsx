import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';

import { NodeKindsSection } from '../../components/node-kinds-section.js';

/** Справочник видов узлов — в «Структуре», не в «Автоматизации» (вердикт
 *  владельца): шестерёнка тулбара открывает это окно. Справочник глобальный,
 *  правит его носитель права `project.setup.manage`; остальные видят список. */
export function NodeKindsDialog({
  open,
  canManage,
  onClose,
}: {
  open: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="max-w-2xl sm:max-w-2xl"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{ui.structure.kindsTitle}</DialogTitle>
        <NodeKindsSection canManage={canManage} embedded />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.common.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
