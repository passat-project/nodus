import { Workflow } from 'lucide-react';
import type { CustomFieldDefinition } from '@nodus/contracts';
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
import { Skeleton } from '@nodus/ui/components/skeleton';
import { toast } from 'sonner';

import { useCustomFieldUsage, useDeleteCustomFields } from '../../api/custom-fields-api.js';

/**
 * Подтверждение удаления атрибутов (одного из меню строки или пачки из
 * островка, вердикт владельца 25.10.2026: удаление вместо архива). Сначала
 * проверяем, где используется: сколько карточек со значением (сотрутся
 * безвозвратно) и маршруты процессов — если атрибут стоит в окне перехода
 * или условии, удаление заблокировано со списком маршрутов (сначала убрать
 * оттуда). Окно без ввода — мимо-клик закрывает (канон подтверждений).
 */
export function FieldDeleteDialog({
  targets,
  onClose,
  onDeleted,
}: {
  targets: readonly CustomFieldDefinition[];
  onClose: () => void;
  onDeleted: (ids: string[]) => void;
}) {
  const ids = targets.map((target) => target.id);
  const usage = useCustomFieldUsage(ids);
  const remove = useDeleteCustomFields();
  const loading = usage.some((query) => query.isLoading);
  const failed = usage.some((query) => query.isError);
  const blocked = targets
    .map((target, index) => ({ target, workflows: usage[index]?.data?.workflows ?? [] }))
    .filter((entry) => entry.workflows.length > 0);
  const values = usage.reduce((sum, query) => sum + (query.data?.valueCount ?? 0), 0);
  const kindNames = [
    ...new Set(usage.flatMap((query) => (query.data?.nodeKinds ?? []).map((kind) => kind.name))),
  ];
  const single = targets.length === 1;

  function confirm() {
    remove.mutate(ids, {
      onSuccess: (count) => {
        // Сервер мог отказать части пачки (маршрут добавили, пока окно
        // было открыто): честный счётчик «удалено n», без ложного успеха.
        if (count === 0) {
          toast.error(ui.common.saveError);
          return;
        }
        toast.success(
          single
            ? ui.customFields.delete.deleted
            : `${ui.customFields.delete.deletedMany} ${count}`,
        );
        onDeleted(ids);
      },
      onError: () => toast.error(ui.common.saveError),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {single ? ui.customFields.delete.titleOne : ui.customFields.delete.titleMany}
          </DialogTitle>
          <DialogDescription>
            {single
              ? `«${targets[0]?.name ?? ''}»`
              : targets.map((target) => `«${target.name}»`).join(', ')}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col gap-2" aria-label={ui.customFields.delete.checking}>
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : failed ? (
          <p className="text-sm text-danger">{ui.common.loadError}</p>
        ) : blocked.length > 0 ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>{single ? ui.customFields.delete.blocked : ui.customFields.delete.blockedMany}</p>
            <ul className="flex flex-col gap-1">
              {blocked.flatMap(({ target, workflows }) =>
                workflows.map((workflow) => (
                  <li
                    key={`${target.id}:${workflow.id}`}
                    className="flex items-center gap-2 text-secondary-foreground"
                  >
                    <Workflow
                      className="size-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span className="truncate">
                      {single ? workflow.name : `${workflow.name} — «${target.name}»`}
                    </span>
                  </li>
                )),
              )}
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              {values > 0 ? (
                <>
                  {ui.customFields.delete.values}{' '}
                  <span className="font-mono tabular-nums">{values}</span>
                </>
              ) : (
                ui.customFields.delete.valuesNone
              )}
            </p>
            {kindNames.length > 0 ? (
              <p className="text-secondary-foreground">
                {ui.customFields.delete.nodeKinds} {kindNames.join(', ')}
              </p>
            ) : null}
            <p className="text-muted-foreground">{ui.customFields.delete.irreversible}</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={remove.isPending}>
            {ui.common.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={loading || failed || blocked.length > 0 || remove.isPending}
            onClick={confirm}
          >
            {ui.customFields.delete.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
