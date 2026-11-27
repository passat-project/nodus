import type { ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';

/**
 * Компактное окно настроек типа (ревизия UI v3, #857) — та же грамматика, что
 * у `SettingsSplitDialog`, но без навигации по разделам: для сущности, у
 * которой настроек немного (тип папки — название, значок, цвет и
 * возможности одной колонкой). Ширина — около 26rem: окно действительно
 * компактное (на 30rem форма тянулась, и тумблеры «Возможностей» уезжали на
 * дальний правый край от своих подписей); высота — по содержимому; футер тот
 * же: слева опасное действие, справа «Закрыть»; мимо-клик окно не закрывает;
 * содержимое скроллится без горизонтальной полосы (`overflow-x-hidden`).
 */
export function SettingsCompactDialog({
  title,
  danger,
  onClose,
  children,
}: {
  title: ReactNode;
  /** Опасное действие внизу слева (архив / возврат из архива). */
  danger?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        className="flex max-h-[92vh] max-w-[26rem] flex-col gap-5 overflow-hidden p-5 sm:max-w-[26rem]"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto pr-1">
          {children}
        </div>

        <DialogFooter className="shrink-0 items-center">
          {danger ? <div className="mr-auto">{danger}</div> : null}
          <Button variant="ghost" onClick={onClose}>
            {ui.common.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
