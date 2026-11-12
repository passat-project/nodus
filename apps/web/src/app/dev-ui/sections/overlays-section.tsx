import { devUiStrings, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@nodus/ui/components/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@nodus/ui/components/tooltip';
import { toast } from 'sonner';

import { DevGroup, DevSection } from '../dev-section.js';

/**
 * Ф4: оверлеи. Тост — канонический канал подтверждений (Toaster уже смонтирован
 * в AppShell), окно — с футером без сепаратора (вердикт 24.09.2026), поповер —
 * поверхность 14px; все три живые: клик показывает реальный примитив, а не
 * картинку «как будет».
 */
export function OverlaysSection() {
  return (
    <DevSection
      id="dev-overlays"
      label={devUiStrings.sections.overlays}
      hint={devUiStrings.overlays.hint}
    >
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <DevGroup
          title={devUiStrings.overlays.tooltip}
          hint={devUiStrings.overlays.tooltipHint}
          caption={devUiStrings.overlays.captionTooltip}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">{devUiStrings.overlays.tooltipTrigger}</Button>
            </TooltipTrigger>
            <TooltipContent>{devUiStrings.overlays.tooltipText}</TooltipContent>
          </Tooltip>
        </DevGroup>

        <DevGroup
          title={devUiStrings.overlays.toast}
          hint={devUiStrings.overlays.toastHint}
          caption={devUiStrings.overlays.captionToast}
        >
          <Button
            variant="secondary"
            onClick={() =>
              toast.success(devUiStrings.overlays.toastTitle, {
                description: devUiStrings.overlays.toastText,
              })
            }
          >
            {devUiStrings.overlays.toastButton}
          </Button>
        </DevGroup>

        <DevGroup
          title={devUiStrings.overlays.dialog}
          hint={devUiStrings.overlays.dialogHint}
          caption={devUiStrings.overlays.captionDialog}
        >
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">{devUiStrings.overlays.dialogTrigger}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{devUiStrings.overlays.dialogTitle}</DialogTitle>
                <DialogDescription>{devUiStrings.overlays.dialogText}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">{ui.common.cancel}</Button>
                </DialogClose>
                <Button>{devUiStrings.overlays.dialogConfirm}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </DevGroup>

        <DevGroup
          title={devUiStrings.overlays.popover}
          hint={devUiStrings.overlays.popoverHint}
          caption={devUiStrings.overlays.captionPopover}
        >
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">{devUiStrings.overlays.popoverTrigger}</Button>
            </PopoverTrigger>
            <PopoverContent className="flex flex-col gap-1">
              <p className="text-body-xs font-semibold">{devUiStrings.overlays.popoverTitle}</p>
              <p className="text-label-sm text-muted-foreground">
                {devUiStrings.overlays.popoverText}
              </p>
            </PopoverContent>
          </Popover>
        </DevGroup>
      </div>
    </DevSection>
  );
}
