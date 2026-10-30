import { useState } from 'react';
import type {
  DepartmentNode,
  OrgUnitKind,
  UpdateDepartmentDto,
  UserListItem,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';

import { useCreateDepartment, useUpdateDepartment } from '../api/directory-api.js';
import { EmployeeCombobox } from './employee-combobox.js';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * Создание/правка подразделения (#84): название + руководитель + зам
 * (автокомплит сотрудников). Тела — zod-схемы contracts (create/update
 * DepartmentDto), мутации оптимистичны (I4): карточка дерева появляется/
 * меняется до ответа, откат при ошибке. Kind = текущая структура вида:
 * подразделение рождается в ТОЙ структуре, из которой его создали.
 */
export function DepartmentDialog({
  open,
  onOpenChange,
  kind,
  parentId,
  editing,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: OrgUnitKind;
  /** Для создания: родитель (null — корень). Для правки игнорируется. */
  parentId: string | null;
  editing: DepartmentNode | null;
  users: UserListItem[];
}) {
  const create = useCreateDepartment(kind);
  const update = useUpdateDepartment(kind);
  const [name, setName] = useState('');
  const [headId, setHeadId] = useState<string | null>(null);
  const [deputyId, setDeputyId] = useState<string | null>(null);

  // Черновик сбрасывается/наполняется на каждом открытии (рендер-тайм, #45).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setName(editing?.name ?? '');
      setHeadId(editing?.headId ?? null);
      setDeputyId(editing?.deputyId ?? null);
    }
  }

  const valid = name.trim().length > 0;
  const pending = create.isPending || update.isPending;
  // Кандидаты — только активные: уволенного сервер не примет (валидация
  // ссылок #441). Текущие значения правки не сбрасываются — их видно в полях.
  const activeUsers = users.filter((user) => user.status === 'active');

  function submit() {
    if (!valid || pending) return;
    if (editing) {
      // Только изменённые поля: неизменённая архивная ссылка не блокирует
      // переименование (сервер валидирует лишь присланное).
      const patch: UpdateDepartmentDto = {};
      if (name.trim() !== editing.name) patch.name = name.trim();
      if (headId !== editing.headId) patch.headId = headId;
      if (deputyId !== editing.deputyId) patch.deputyId = deputyId;
      if (Object.keys(patch).length === 0) {
        onOpenChange(false);
        return;
      }
      update.mutate({ id: editing.id, patch }, { onSuccess: () => onOpenChange(false) });
      return;
    }
    create.mutate(
      { name: name.trim(), kind, parentId, headId, deputyId, sortOrder: 0 },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-full bg-card sm:max-w-md"
        // Форма с несохранёнными значениями: мимо-клик не должен её терять
        // (канон окон с заполняемыми данными); закрытие — «Отмена» или Esc.
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="text-base font-semibold text-foreground">
          {editing ? ui.employees.editDepartmentTitle : ui.employees.createDepartment}
        </DialogTitle>
        <div className="flex flex-col gap-3">
          <Field label={ui.employees.fieldDepartmentName}>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-sm"
            />
          </Field>
          <Field label={ui.employees.fieldHead}>
            <EmployeeCombobox
              value={headId}
              onChange={setHeadId}
              ariaLabel={ui.employees.fieldHead}
              placeholder={ui.employees.managerPlaceholder}
              users={activeUsers}
            />
          </Field>
          <Field label={ui.employees.fieldDeputy}>
            <EmployeeCombobox
              value={deputyId}
              onChange={setDeputyId}
              ariaLabel={ui.employees.fieldDeputy}
              placeholder={ui.employees.managerPlaceholder}
              users={activeUsers}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {ui.common.cancel}
          </Button>
          <Button disabled={!valid || pending} onClick={submit}>
            {ui.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
