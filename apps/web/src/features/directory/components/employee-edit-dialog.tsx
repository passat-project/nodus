import { useState } from 'react';
import type { UpdateUserDto, UserCard, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { useDepartmentsList } from '../../../shared/api/departments-list.js';
import { usePositions, useUpdateUser } from '../api/directory-api.js';
import { EmployeeCombobox } from './employee-combobox.js';

/** Sentinel Radix Select для «не выбрано» (пустая строка значением запрещена). */
const NONE = '__none__';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * Правка оргструктурных полей сотрудника (#441, право `directory.manage`):
 * подразделение (управленческая структура), должность, руководитель —
 * свободная ссылка на любого активного сотрудника (кейс «группа ГИПов»).
 * Мутация оптимистична (I4), ошибки валидации ссылок показывает сервер
 * (`DIRECTORY_REFERENCE_INVALID`), откат — в хуке.
 */
export function EmployeeEditDialog({
  open,
  onOpenChange,
  card,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: UserCard;
  users: UserListItem[];
}) {
  const update = useUpdateUser(card.id);
  const departments = useDepartmentsList();
  const positions = usePositions('management').data ?? [];
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [positionId, setPositionId] = useState<string | null>(null);
  const [managerId, setManagerId] = useState<string | null>(null);

  // Черновик наполняется на каждом открытии (рендер-тайм, #45).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setDepartmentId(card.departmentId);
      setPositionId(card.positionId);
      setManagerId(card.managerId);
    }
  }

  // Текущий руководитель может быть уволен — оставляем его в кандидатах,
  // чтобы имя не «пропадало» из поля (отправка идёт только при изменении).
  const managerCandidates = users.filter(
    (user) => user.id !== card.id && (user.status === 'active' || user.id === card.managerId),
  );
  const pending = update.isPending;

  function submit() {
    if (pending) return;
    // Шлём ТОЛЬКО изменённые поля: неизменённые архивные/уволенные ссылки
    // (сервер их не примет при повторной отправке) не мешают сохранить правку.
    const patch: UpdateUserDto = {};
    if (departmentId !== card.departmentId) patch.departmentId = departmentId;
    if (positionId !== card.positionId) patch.positionId = positionId;
    if (managerId !== card.managerId) patch.managerId = managerId;
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    update.mutate(patch, { onSuccess: () => onOpenChange(false) });
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
          {ui.employees.editEmployeeTitle}
        </DialogTitle>
        <div className="flex flex-col gap-3">
          <Field label={ui.employees.department}>
            <Select
              value={departmentId ?? NONE}
              onValueChange={(value) => setDepartmentId(value === NONE ? null : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              {/* Список — вниз от поля (не поверх подписи): дерево читается
                  отступами, а не дефисами в тексте. */}
              <SelectContent position="popper" sideOffset={4}>
                <SelectItem value={NONE}>{ui.employees.notSelected}</SelectItem>
                {departmentId && !departments.some((d) => d.id === departmentId) && (
                  <SelectItem value={departmentId} disabled>
                    {ui.employees.archivedValue}
                  </SelectItem>
                )}
                {departments.map((department) => (
                  <SelectItem
                    key={department.id}
                    value={department.id}
                    style={{ paddingLeft: `${0.5 + department.depth * 0.8}rem` }}
                  >
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={ui.employees.position}>
            <Select
              value={positionId ?? NONE}
              onValueChange={(value) => setPositionId(value === NONE ? null : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4}>
                <SelectItem value={NONE}>{ui.employees.notSelected}</SelectItem>
                {positionId && !positions.some((p) => p.id === positionId) && (
                  <SelectItem value={positionId} disabled>
                    {ui.employees.archivedValue}
                  </SelectItem>
                )}
                {positions.map((position) => (
                  <SelectItem key={position.id} value={position.id}>
                    {position.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={ui.employees.fieldManager}>
            <EmployeeCombobox
              value={managerId}
              onChange={setManagerId}
              ariaLabel={ui.employees.fieldManager}
              placeholder={ui.employees.managerPlaceholder}
              users={managerCandidates}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {ui.common.cancel}
          </Button>
          <Button disabled={pending} onClick={submit}>
            {ui.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
