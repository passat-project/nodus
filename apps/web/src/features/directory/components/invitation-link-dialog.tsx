import { Copy } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nodus/ui/components/dialog';
import { Field, FieldLabel } from '@nodus/ui/components/field';
import { toast } from 'sonner';

/** Копирование одноразовой ссылки (#101): одна ручка на поле и главную кнопку. */
export async function copyTokenLink(link: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(link);
    toast.success(ui.common.linkCopied);
  } catch {
    toast.error(ui.common.copyError);
  }
}

/**
 * Поле одноразовой ссылки (#101): строка с многоточием и полной ссылкой в
 * `title` (образец — `shared/custom-fields/path-value.tsx`), копирование рядом.
 * Readonly-Input обрезал URL без подсказки — админ не видел, что ссылка цела.
 */
export function TokenLinkField({ link }: { link: string }) {
  return (
    <Field>
      <FieldLabel>{ui.employees.inviteLinkLabel}</FieldLabel>
      <div className="flex h-8 items-center gap-1 rounded-lg border border-input pr-1 pl-2.5">
        <span
          role="textbox"
          aria-readonly="true"
          aria-label={ui.employees.inviteLinkLabel}
          data-token-link
          title={link}
          className="min-w-0 flex-1 truncate font-mono text-[13px]"
        >
          {link}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-muted-foreground"
          aria-label={ui.employees.inviteCopyLink}
          title={ui.employees.inviteCopyLink}
          onClick={() => void copyTokenLink(link)}
        >
          <Copy className="size-3.5" strokeWidth={1.75} />
        </Button>
      </div>
    </Field>
  );
}

/** Окно одноразовой ссылки (#101): показывается сразу после создания,
 *  перевыпуска или сброса — сервер не может показать её повторно (в БД хеш). */
export function InvitationLinkDialog({
  open,
  onOpenChange,
  title,
  lead,
  link,
  expiresAt,
  expiresLabel = ui.employees.inviteLinkExpires,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  lead: string;
  link: string;
  expiresAt: string;
  expiresLabel?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-lg">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{lead}</DialogDescription>
        <div className="flex flex-col gap-4 pt-2">
          <TokenLinkField link={link} />
          <p className="text-sm text-muted-foreground">
            {expiresLabel}{' '}
            <span className="font-medium text-foreground">
              {new Date(expiresAt).toLocaleString('ru-RU')}
            </span>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {ui.common.close}
            </Button>
            <Button onClick={() => void copyTokenLink(link)}>{ui.employees.inviteCopyLink}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
