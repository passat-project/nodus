import { useState } from 'react';
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
import { Input } from '@nodus/ui/components/input';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { toast } from 'sonner';

import { useCustomFieldUsage, useDeleteCustomFields } from '../../api/custom-fields-api.js';
import { plural } from '../../../../shared/lib/format.js';

/** Одна группа последствий (Р8): заголовок + строки. Пустая группа
 *  скрывается — окно перечисляет только реальный урон. */
function Group({ title, lines }: { title: string; lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-label text-muted-foreground">{title}</p>
      <ul className="flex flex-col gap-0.5">
        {lines.map((line) => (
          <li key={line} className="truncate text-sm text-secondary-foreground">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Окно удаления атрибутов (#631, Р8 — удаление разрешено ВСЕГДА): сначала
 * агрегат последствий — значения по сущностям, формы создания, кнопки и
 * условия маршрутов (маршрут продолжит работать, но повторная публикация
 * потребует убрать ключ), привязки, глобальное значение. Подтверждение —
 * ввод точного названия (регистр не важен: названия и так уникальны без
 * регистра), кнопка активируется при совпадении (паттерн GitHub/GitLab для
 * безвозвратных удалений).
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
  const [typed, setTyped] = useState('');
  const loading = usage.some((query) => query.isLoading);
  const failed = usage.some((query) => query.isError);
  const single = targets.length === 1;

  // Подтверждение: для пачки — название первого (окно пачки показывает
  // полный перечень целей, ввод один — защита от случайного клика).
  const expected = (targets[0]?.name ?? '').trim().toLowerCase();
  const confirmed = typed.trim().toLowerCase() === expected && expected.length > 0;

  const valuesLines = usage.flatMap((query) => {
    const values = query.data?.values;
    if (!values) return [];
    const e = ui.customFields.delete.entities;
    const parts: string[] = [];
    if (values.task > 0) parts.push(`${values.task} ${plural(values.task, e.task)}`);
    if (values.letter > 0) parts.push(`${values.letter} ${plural(values.letter, e.letter)}`);
    if (values.counterparty > 0) {
      parts.push(`${values.counterparty} ${plural(values.counterparty, e.counterparty)}`);
    }
    if (values.project > 0) parts.push(`${values.project} ${plural(values.project, e.project)}`);
    if (values.node > 0) parts.push(`${values.node} ${plural(values.node, e.node)}`);
    return parts;
  });
  const formsLines = usage.flatMap((query) =>
    (query.data?.forms ?? []).map(
      (form) =>
        `${form.name} (${ui.customFields.delete.formKinds[form.kind]}${
          form.draft ? `, ${ui.customFields.delete.draft}` : ''
        })`,
    ),
  );
  const workflowsLines = usage.flatMap((query) => (query.data?.workflows ?? []).map((w) => w.name));
  const bindingsLines = usage.flatMap((query) => {
    const bindings = query.data?.bindings;
    if (!bindings) return [];
    return [
      ...bindings.processTypes.map((t) => t.name),
      ...bindings.projectTypes.map((t) => t.name),
      ...bindings.nodeKinds.map((k) => k.name),
    ];
  });
  const companyFilled = usage.some((query) => query.data?.companyValue === true);

  function confirm() {
    if (!confirmed) return;
    remove.mutate(ids, {
      onSuccess: (count) => {
        // Пачка могла частично отказать (сервер всегда разрешает, но сеть
        // может уронить часть): честный счётчик «удалено n».
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
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <Group
              title={ui.customFields.delete.groupValues}
              lines={valuesLines.length > 0 ? valuesLines : [ui.customFields.delete.valuesNone]}
            />
            <Group title={ui.customFields.delete.groupForms} lines={formsLines} />
            <Group
              title={ui.customFields.delete.groupWorkflows}
              lines={
                workflowsLines.length > 0 ? workflowsLines : [ui.customFields.delete.workflowsNone]
              }
            />
            <Group
              title={ui.customFields.delete.groupBindings}
              lines={
                bindingsLines.length > 0 ? bindingsLines : [ui.customFields.delete.bindingsNone]
              }
            />
            {companyFilled ? (
              <Group
                title={ui.customFields.delete.groupCompany}
                lines={[ui.customFields.delete.companyLine]}
              />
            ) : null}
            <p className="text-muted-foreground">{ui.customFields.delete.irreversible}</p>
          </div>
        )}

        {!loading && !failed ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">
              {ui.customFields.delete.typeToConfirm}
            </span>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={ui.customFields.delete.typeToConfirmPlaceholder}
              // Ошибка — только после попытки: пустое поле не «провинилось».
              aria-invalid={typed.trim() !== '' && !confirmed ? true : undefined}
              className="h-8 text-sm"
              autoFocus
            />
          </label>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={remove.isPending}>
            {ui.common.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={loading || failed || !confirmed || remove.isPending}
            onClick={confirm}
          >
            {ui.customFields.delete.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
