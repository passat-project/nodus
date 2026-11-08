import { useState } from 'react';
import { ErrorCode, errorMessages, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Checkbox } from '@nodus/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { CircleAlert, ListOrdered } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '../../../../shared/api-client.js';
import { useNumberBackfill, useNumberBackfillPreview } from '../../api/numbering-api.js';
import { fill } from '../../lib/counter-rule.js';
import { countTitle } from './counter-counts.js';

const counter = ui.customFields.dialog.counter;
const backfill = counter.backfill;

/**
 * «Выдать номера существующим» (#630, вердикт владельца 08.11): только из
 * настройки счётчика — всплывающее окно с предпросмотром (сколько, в каких
 * счетах, первые и последние номера, кто не получит и почему, порядок — по
 * дате создания) и кнопкой одобрения. В карточках записей кнопки нет.
 */
function CounterBackfillDialog({
  definitionId,
  onClose,
}: {
  definitionId: string;
  onClose: () => void;
}) {
  const preview = useNumberBackfillPreview(definitionId, true);
  const run = useNumberBackfill(definitionId);
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const data = preview.data;

  async function approve() {
    if (!data || data.total === 0) return;
    try {
      const result = await run.mutateAsync({
        expectedTotal: data.total,
        ...(includeEmpty ? { confirmEmptyNumberParts: true as const } : {}),
      });
      toast.success(fill(backfill.done, { count: String(result.issued) }));
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === ErrorCode.NUMBER_BACKFILL_STALE) {
        toast.error(errorMessages[ErrorCode.NUMBER_BACKFILL_STALE]);
        void preview.refetch();
        return;
      }
      toast.error(ui.customFields.dialog.saveError);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex max-h-[min(80vh,40rem)] flex-col gap-4 sm:max-w-[34rem]">
        <DialogHeader>
          <DialogTitle>{backfill.title}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-sm">
          {!data ? null : data.total === 0 ? (
            <p className="text-muted-foreground">{backfill.none}</p>
          ) : (
            <>
              <p>{fill(backfill.lead, { total: String(data.total) })}</p>
              <ul className="flex flex-col gap-1 rounded-lg border border-input p-2">
                {data.groups.map((group) => {
                  const title = countTitle(group.containers);
                  const where = title.path ? `${title.path} › ${title.name}` : title.name;
                  return (
                    <li
                      key={group.containers.map((ref) => ref.id).join('|') || 'common'}
                      className="flex min-w-0 items-baseline gap-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{where}</span>
                      <span className="shrink-0 font-mono font-medium tabular-nums">
                        {group.count > 1
                          ? fill(backfill.group, {
                              where: '',
                              first: group.firstDisplay,
                              last: group.lastDisplay,
                            }).replace(/^:\s*/, '')
                          : group.firstDisplay}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        ({group.count})
                      </span>
                    </li>
                  );
                })}
              </ul>
              {data.blockedTotal > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="flex items-center gap-1.5 text-warning">
                    <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
                    {fill(backfill.blocked, { count: String(data.blockedTotal) })}
                  </p>
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {data.blocked.map((sample) => (
                      <li key={sample.id}>{sample.name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {data.emptyParts > 0 ? (
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={includeEmpty}
                    onCheckedChange={(checked) => setIncludeEmpty(checked === true)}
                    aria-label={backfill.emptyPartsInclude}
                  />
                  {fill(backfill.emptyParts, { count: String(data.emptyParts) })} —{' '}
                  {backfill.emptyPartsInclude}
                </label>
              ) : null}
              <p className="text-xs text-muted-foreground">{backfill.forever}</p>
            </>
          )}
        </div>
        <DialogFooter className="items-center gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {backfill.cancel}
          </Button>
          <Button
            type="button"
            disabled={!data || data.total === 0 || run.isPending}
            onClick={() => void approve()}
          >
            {fill(backfill.confirm, { total: String(data?.total ?? 0) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Кнопка в окне правила: видна, только если есть записи без номера. */
export function CounterBackfillButton({
  definitionId,
  count,
  disabled,
}: {
  definitionId: string;
  count: number;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <ListOrdered className="size-4" strokeWidth={1.75} />
        {fill(backfill.open, { count: String(count) })}
      </Button>
      {open ? (
        <CounterBackfillDialog definitionId={definitionId} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
