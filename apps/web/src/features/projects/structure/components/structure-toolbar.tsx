import { ChevronsDownUp, ChevronsUpDown, FolderPlus, SearchX } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@nodus/ui/components/empty';

import { ListToolbar } from '../../../../shared/views/list-toolbar.js';
import type { ListToolbarState } from '../../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../../shared/views/view-settings.js';
import { STRUCTURE_VIEW_KEY, structureFields } from '../lib/structure-fields.js';

/** Строка инструментов структуры — тот же `ListToolbar`, что у «Задач»
 *  (одинаковая высота и калибр кнопок): создание, поиск, свернуть/развернуть
 *  справа, шестерёнка колонок. Виды папок настраиваются в «Автоматизации»
 *  (#556) — шестерёнки справочника здесь больше нет. */
export function StructureToolbar({
  toolbar,
  canEdit,
  onCreateNode,
  onExpandAll,
  onCollapseAll,
}: {
  toolbar: ListToolbarState;
  canEdit: boolean;
  onCreateNode: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <ListToolbar
      toolbar={toolbar}
      defs={[]}
      left={
        canEdit ? (
          <Button type="button" onClick={onCreateNode}>
            <FolderPlus data-icon="inline-start" />
            {ui.structure.createNode}
          </Button>
        ) : null
      }
      right={
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={ui.structure.expandAll}
            aria-label={ui.structure.expandAll}
            onClick={onExpandAll}
          >
            <ChevronsUpDown className="size-3.5" strokeWidth={1.75} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={ui.structure.collapseAll}
            aria-label={ui.structure.collapseAll}
            onClick={onCollapseAll}
          >
            <ChevronsDownUp className="size-3.5" strokeWidth={1.75} />
          </Button>
          <ViewSettings viewKey={STRUCTURE_VIEW_KEY} defs={structureFields} />
        </>
      }
    />
  );
}

/** Пустое состояние структуры: узлов ещё нет — первый узел отсюда. */
export function StructureEmpty({ onCreateNode }: { onCreateNode: () => void }) {
  return (
    <Empty className="min-h-96 border-0">
      <EmptyMedia variant="icon">
        <FolderPlus className="size-4" />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{ui.structure.empty}</EmptyTitle>
        <EmptyDescription>{ui.structure.emptyHint}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" onClick={onCreateNode}>
          <FolderPlus data-icon="inline-start" />
          {ui.structure.createNode}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** Пустой результат поиска по структуре. */
export function StructureSearchEmpty({ onReset }: { onReset: () => void }) {
  return (
    <Empty className="min-h-72 border-0">
      <EmptyMedia variant="icon">
        <SearchX className="size-4" />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{ui.structure.searchEmpty}</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" variant="ghost" onClick={onReset}>
          {ui.structure.searchReset}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
