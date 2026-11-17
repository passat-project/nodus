import { useRef, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import type { DepartmentOption } from '../../../shared/api/departments-list.js';
import { useCreateDepartment, useUpdateDepartment } from '../api/directory-api.js';
import { EmployeeCombobox } from './employee-combobox.js';

/** Sentinel Radix Select для «без родителя» (пустая строка запрещена). */
const NO_PARENT = '__none__';

/** Id узла и всего его поддерева — при переносе исключаем из кандидатов
 *  родителей (узел не может стать потомком сам себя; сервер тоже защищает). */
function collectSubtreeIds(node: DepartmentNode): Set<string> {
  const ids = new Set<string>([node.id]);
  for (const child of node.children) {
    for (const id of collectSubtreeIds(child)) ids.add(id);
  }
  return ids;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * Создание/правка отдела (#84): название + руководитель + зам
 * (автокомплит сотрудников). Тела — zod-схемы contracts (create/update
 * DepartmentDto), мутации оптимистичны (I4): карточка дерева появляется/
 * меняется до ответа, откат при ошибке. Kind = текущая структура вида:
 * отдел рождается в ТОЙ структуре, из которой его создали.
 */
export function DepartmentDialog({
  open,
  onOpenChange,
  kind,
  parentId,
  editing,
  users,
  departmentOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: OrgUnitKind;
  /** Для создания: родитель по умолчанию (null — корень). */
  parentId: string | null;
  editing: DepartmentNode | null;
  users: UserListItem[];
  /** Плоское дерево ТЕКУЩЕГО вида (отступы depth) — выбор родителя/перенос. */
  departmentOptions: DepartmentOption[];
}) {
  const create = useCreateDepartment(kind);
  const update = useUpdateDepartment(kind);
  const [name, setName] = useState('');
  const [headId, setHeadId] = useState<string | null>(null);
  const [deputyId, setDeputyId] = useState<string | null>(null);
  const [parentDraft, setParentDraft] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Окно открылось — до первого действия пользователя гасим авто-выделение
  // текста, которое Radix FocusScope делает, возвращая фокус в поле.
  const autoSelectGuard = useRef(false);

  // Черновик сбрасывается/наполняется на каждом открытии (рендер-тайм, #45).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setName(editing?.name ?? '');
      setHeadId(editing?.headId ?? null);
      setDeputyId(editing?.deputyId ?? null);
      setParentDraft(editing ? editing.parentId : parentId);
    }
  }

  const valid = name.trim().length > 0;
  const pending = create.isPending || update.isPending;
  // Кандидаты — только активные: уволенного сервер не примет (валидация
  // ссылок #441). Текущие значения правки не сбрасываются — их видно в полях.
  // Текущий руководитель/зам может быть уволен — показываем его в кандидатах,
  // чтобы имя не «пропадало» из поля (отправка идёт только при изменении).
  const headCandidates = users.filter((user) => user.status === 'active' || user.id === headId);
  const deputyCandidates = users.filter((user) => user.status === 'active' || user.id === deputyId);
  // Перенос: узел не может стать потомком сам себя — исключаем своё поддерево
  // (сервер дополнительно защищает от циклов).
  const excluded = editing ? collectSubtreeIds(editing) : new Set<string>();
  const parentOptions = departmentOptions.filter((option) => !excluded.has(option.id));
  // Создание из карточки: родитель задан контекстом — показываем его имя.
  const parentName = departmentOptions.find((option) => option.id === parentDraft)?.name ?? null;

  function submit() {
    if (!valid || pending) return;
    if (editing) {
      // Только изменённые поля: неизменённая архивная ссылка не блокирует
      // переименование (сервер валидирует лишь присланное).
      const patch: UpdateDepartmentDto = {};
      if (name.trim() !== editing.name) patch.name = name.trim();
      if (headId !== editing.headId) patch.headId = headId;
      if (deputyId !== editing.deputyId) patch.deputyId = deputyId;
      if (parentDraft !== editing.parentId) patch.parentId = parentDraft;
      if (Object.keys(patch).length === 0) {
        onOpenChange(false);
        return;
      }
      update.mutate({ id: editing.id, patch }, { onSuccess: () => onOpenChange(false) });
      return;
    }
    create.mutate(
      { name: name.trim(), kind, parentId: parentDraft, headId, deputyId, sortOrder: 0 },
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
        // Radix ставит фокус первым полем и ВЫДЕЛЯЕТ текст: курсор — «в конце без
        // выделения», иначе первое нажатие клавиши стирало название (#768).
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          autoSelectGuard.current = true;
          // Каретку ставим следующим кадром: FocusScope возвращает фокус в поле
          // с `select()` уже после обработчика (закрытие меню «⋯»).
          requestAnimationFrame(() => {
            const input = nameRef.current;
            if (!input || !input.isConnected) return;
            input.focus();
            const end = input.value.length;
            input.setSelectionRange(end, end);
          });
        }}
      >
        <DialogTitle className="text-base font-semibold text-foreground">
          {editing ? ui.employees.editDepartmentTitle : ui.employees.createDepartment}
        </DialogTitle>
        <div className="flex flex-col gap-3">
          <Field label={ui.employees.fieldDepartmentName}>
            <Input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(event) => {
                // FocusScope при возврате фокуса в поле зовёт `element.select()`
                // (уход фокуса из окна при закрытии меню «⋯»): снимаем выделение
                // следующим кадром, пока пользователь не начал работать.
                const input = event.currentTarget;
                if (!autoSelectGuard.current) return;
                requestAnimationFrame(() => {
                  if (!autoSelectGuard.current || !input.isConnected) return;
                  if (input.selectionStart === 0 && input.selectionEnd === input.value.length) {
                    const end = input.value.length;
                    input.setSelectionRange(end, end);
                  }
                });
              }}
              onPointerDown={() => {
                autoSelectGuard.current = false;
              }}
              onKeyDown={() => {
                autoSelectGuard.current = false;
              }}
              className="h-8 text-sm"
            />
          </Field>
          <Field label={ui.employees.parentDepartment}>
            {editing ? (
              <Select
                value={parentDraft ?? NO_PARENT}
                onValueChange={(value) => setParentDraft(value === NO_PARENT ? null : value)}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  side="bottom"
                  // Только вниз и с прокруткой: иначе список родителей
                  // раздувал окно и уезжал вверх за край (вердикт 17.11.2026).
                  avoidCollisions={false}
                  className="max-h-60"
                >
                  <SelectItem value={NO_PARENT}>{ui.employees.noParent}</SelectItem>
                  {parentOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              // Создание — родитель задан контекстом (карточка/пустое
              // состояние): только имя, без выбора и тире уровней (#768).
              <span className="flex h-8 min-w-0 items-center text-sm text-foreground">
                <span className="truncate" title={parentName ?? ui.employees.noParent}>
                  {parentName ?? ui.employees.noParent}
                </span>
              </span>
            )}
          </Field>
          <Field label={ui.employees.fieldHead}>
            <EmployeeCombobox
              value={headId}
              onChange={setHeadId}
              ariaLabel={ui.employees.fieldHead}
              placeholder={ui.employees.managerPlaceholder}
              users={headCandidates}
            />
          </Field>
          <Field label={ui.employees.fieldDeputy}>
            <EmployeeCombobox
              value={deputyId}
              onChange={setDeputyId}
              ariaLabel={ui.employees.fieldDeputy}
              placeholder={ui.employees.managerPlaceholder}
              users={deputyCandidates}
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
