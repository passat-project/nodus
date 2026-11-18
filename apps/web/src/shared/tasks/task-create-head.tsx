import { Button } from '@nodus/ui/components/button';
import { DialogClose } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { ui } from '@nodus/contracts';
import { X } from 'lucide-react';

/**
 * Верх окна создания задачи (#432, вердикт владельца 26.10.2026): строка
 * названия с крестиком-кнопкой по центру строки и подпись контекста
 * («из сообщения», «в папке»). Крестик — в строке названия, не угловой:
 * правый край окна ровный, поле названия и поле типа кончаются на одной
 * вертикали. Вынесено из окна ради лимита строк.
 */
export function TaskCreateHead({
  title,
  contextLabel,
  onTitle,
  onClose,
}: {
  title: string;
  contextLabel: string | undefined;
  onTitle: (title: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          value={title}
          onChange={(event) => onTitle(event.target.value)}
          placeholder={ui.taskCreate.titlePlaceholder}
          aria-label={ui.taskCreate.titlePlaceholder}
          className="h-9 min-w-0 flex-1 text-body-lg"
        />
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            aria-label={ui.common.close}
            title={ui.common.close}
            onClick={onClose}
          >
            <X className="size-4" strokeWidth={1.75} />
          </Button>
        </DialogClose>
      </div>
      {contextLabel ? <p className="text-xs text-muted-foreground">{contextLabel}</p> : null}
    </>
  );
}
