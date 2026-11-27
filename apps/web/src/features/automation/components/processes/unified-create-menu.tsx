import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { DraftingCompass, Folder, ListPlus, SquareCheck } from 'lucide-react';

/**
 * Кнопка создания шапки колонки «Процессов» — ЕДИНСТВЕННАЯ точка создания
 * типов (модель связей #857, вердикты владельца 27.11). Значок `ListPlus`
 * (плюс к списку — скромный «+» отвергнут), меню раскрывается ВПРАВО от
 * кнопки и несёт строку-иконку каждой сущности: тип проекта, тип задачи,
 * тип папки (по правам; у «Писем» создания нет — каталог заморожен, #55).
 * Созданный тип появляется в своей группе неподключённым — его подключают
 * окном пикера в типах.
 */
export function UnifiedCreateMenu({
  canSetup,
  canManage,
  onCreateProject,
  onCreateTask,
  onCreateKind,
}: {
  canSetup: boolean;
  canManage: boolean;
  onCreateProject: () => void;
  onCreateTask: () => void;
  onCreateKind: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={ui.automation.entry.columnCreate}
          title={ui.automation.entry.columnCreate}
          className="shrink-0 text-muted-foreground"
        >
          <ListPlus className="size-4" strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {canSetup ? (
          <DropdownMenuItem onSelect={onCreateProject}>
            <DraftingCompass className="size-4" strokeWidth={1.75} />
            {ui.automation.entry.createProjectType}
          </DropdownMenuItem>
        ) : null}
        {canManage ? (
          <DropdownMenuItem onSelect={onCreateTask}>
            <SquareCheck className="size-4" strokeWidth={1.75} />
            {ui.automation.entry.createTaskType}
          </DropdownMenuItem>
        ) : null}
        {canSetup ? (
          <DropdownMenuItem onSelect={onCreateKind}>
            <Folder className="size-4" strokeWidth={1.75} />
            {ui.projects.schemasCreateKind}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
