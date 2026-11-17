import { Building2, Search, UserRound } from 'lucide-react';
import { useRef, useState } from 'react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { searchStructure } from '../lib/structure-search.js';

const RESULT_LIMIT = 8;

/**
 * Поиск по структуре (#768): отделы и активные сотрудники в одной
 * выпадашке. Дерево НЕ фильтруется — выбор результата раскрывает предков,
 * центрирует канвас и открывает панель; запрос очищается после выбора.
 * На узкой шапке поиск уходит в иконку с той же выпадашкой.
 */
export function StructureSearch({
  roots,
  users,
  compact = false,
  onPickDepartment,
  onPickEmployee,
  className,
}: {
  roots: DepartmentNode[];
  users: readonly UserListItem[];
  /** Узкая шапка: иконка раскрывает поповер с полем и результатами. */
  compact?: boolean;
  onPickDepartment: (id: string) => void;
  onPickEmployee: (user: UserListItem) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const fromPointer = useRef(false);
  const results = searchStructure(roots, users, text);
  const departments = results.departments.slice(0, RESULT_LIMIT);
  const employees = results.employees.slice(0, RESULT_LIMIT);
  const empty = departments.length === 0 && employees.length === 0;
  const showResults = text.trim().length > 0;

  function close() {
    setText('');
    setOpen(false);
  }

  function pickDepartment(id: string) {
    onPickDepartment(id);
    close();
  }

  function pickEmployee(user: UserListItem) {
    onPickEmployee(user);
    close();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Enter' && showResults) {
      const department = departments[0];
      const employee = employees[0];
      if (department) pickDepartment(department.id);
      else if (employee) pickEmployee(employee);
    }
  }

  const resultsList = showResults ? (
    <div className="flex max-h-80 flex-col gap-1 overflow-auto">
      {departments.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="px-2 py-1 text-xs font-medium text-muted-foreground">
            {ui.employees.searchDepartments}
          </span>
          {departments.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => pickDepartment(node.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{node.name}</span>
            </button>
          ))}
        </div>
      )}
      {employees.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="px-2 py-1 text-xs font-medium text-muted-foreground">
            {ui.employees.searchEmployees}
          </span>
          {employees.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => pickEmployee(user)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <UserRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{user.displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {user.positionName ?? ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {empty && (
        <span className="px-2 py-1.5 text-xs text-muted-foreground">{ui.filters.notFound}</span>
      )}
    </div>
  ) : null;

  if (compact) {
    return (
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next && fromPointer.current) {
            fromPointer.current = false;
            return;
          }
          if (!next) setText('');
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={ui.employees.structureSearch}
            title={ui.employees.structureSearch}
            className="text-muted-foreground hover:text-foreground"
          >
            <Search className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          <Input
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={ui.employees.structureSearch}
            aria-label={ui.employees.structureSearch}
            className="h-8 text-sm"
          />
          {resultsList}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover
      open={open && showResults}
      onOpenChange={(next) => {
        // Гард указательного устройства: клик по результату не должен
        // закрывать поповер раньше выбора (Radix dismiss по pointer-down).
        if (!next && fromPointer.current) {
          fromPointer.current = false;
          return;
        }
        if (!next) setText('');
        setOpen(next);
      }}
    >
      <div className={cn('relative w-[28rem] min-w-56 shrink', className)}>
        <PopoverAnchor asChild>
          <Input
            value={text}
            onChange={(event) => {
              const next = event.target.value;
              setText(next);
              setOpen(next.trim().length > 0);
            }}
            onKeyDown={onKeyDown}
            placeholder={ui.employees.structureSearch}
            aria-label={ui.employees.structureSearch}
            className="h-8 pl-7 text-sm"
          />
        </PopoverAnchor>
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-1"
        // Канон (docs/gotchas/frontend.md, «Radix Popover из фокуса»): фокус
        // остаётся в поле — иначе первый клик уводит его в контент и печатать
        // можно только со второго клика.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDown={() => {
          fromPointer.current = true;
        }}
      >
        {resultsList}
      </PopoverContent>
    </Popover>
  );
}
