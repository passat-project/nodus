import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nodus/ui/components/dialog';
import { Field, FieldLabel } from '@nodus/ui/components/field';
import { Input } from '@nodus/ui/components/input';
import { toast } from 'sonner';

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
  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(ui.common.linkCopied);
    } catch {
      toast.error(ui.common.copyError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-lg">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{lead}</DialogDescription>
        <div className="flex flex-col gap-4 pt-2">
          <Field>
            <FieldLabel htmlFor="token-link">{ui.employees.inviteLinkLabel}</FieldLabel>
            <Input
              id="token-link"
              readOnly
              value={link}
              onFocus={(event) => event.target.select()}
            />
          </Field>
          <p className="text-sm text-muted-foreground">
            {expiresLabel}{' '}
            <span className="font-medium text-foreground">
              {new Date(expiresAt).toLocaleString('ru-RU')}
            </span>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => void copyLink()}>
              {ui.employees.inviteCopyLink}
            </Button>
            <Button onClick={() => onOpenChange(false)}>{ui.common.close}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
