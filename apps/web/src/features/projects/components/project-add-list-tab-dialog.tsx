import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ListTodo, Mail, FolderTree } from 'lucide-react';
import type { ListEntity, SavedView } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { useCustomFieldDefinitions } from '../../../shared/custom-fields/queries.js';
import { FilterPanel } from '../../../shared/views/filter-panel.js';
import { FilterPanelExtSections } from '../../../shared/views/filter-panel-ext.js';
import type {
  FilterFieldDef,
  FilterState,
  FilterValue,
} from '../../../shared/views/list-filters.js';
import {
  groupFieldOptions,
  numericFieldOptions,
} from '../../../shared/views/list-ext/list-field-options.js';
import { splitAttributeFilter } from '../../../shared/views/list-ext/list-ext-predicates.js';
import { useListExt } from '../../../shared/views/list-ext/use-list-ext.js';
import { useCreateSavedView } from '../../../shared/views/list-ext/saved-views-api.js';
import type { FilterPreset } from '../../../shared/views/use-list-toolbar.js';
import { useFilterDefsOfEntity } from '../lib/view-tab-filter-defs.js';

const ENTITY_CHOICES: { entity: ListEntity; label: string; icon: typeof ListTodo }[] = [
  { entity: 'task', label: ui.lists.tabs.entityTask, icon: ListTodo },
  { entity: 'letter', label: ui.lists.tabs.entityLetter, icon: Mail },
  { entity: 'folder', label: ui.lists.tabs.entityFolder, icon: FolderTree },
];

/** Сеансовый (не persisted) набор фильтров диалога: та же форма, что у
 *  ListToolbarState — панель фильтра работает без изменений. */
function useEphemeralFilters() {
  const [filters, setFilters] = useState<FilterState>({});
  const setFilter = (id: string, value: FilterValue) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') delete next[id];
      else next[id] = value;
      return next;
    });
  };
  return {
    toolbar: {
      query: '',
      setQuery: () => undefined,
      filters,
      setFilter,
      setFilters: (state: FilterState) => setFilters({ ...state }),
      resetAll: () => setFilters({}),
      presets: [] as FilterPreset[],
      pinnedId: undefined,
      savePreset: () => undefined,
      deletePreset: () => undefined,
      togglePin: () => undefined,
    },
    filters,
  };
}

/**
 * Окно новой вкладки-списка проекта (#435): «+» полосы вкладок → «Список…» →
 * что показывать (задачи этого проекта / письма / папки) → та же панель
 * фильтра, что в журналах (условия, колонки задаются шестерёнкой вкладки,
 * группировка, итоги) → название и доступ (общая проектная — руководство,
 * личная — себе) → «Сохранить вкладкой». Рамку проекта окно не предлагает
 * снять — условий projectId в панели нет.
 */
export function ProjectAddListTabDialog({
  projectId,
  canManage,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  /** Руководство проекта: может сохранить общую вкладку (сервер решает). */
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (view: SavedView) => void;
}) {
  const t = ui.lists.tabs;
  const [entity, setEntity] = useState<ListEntity>('task');
  const [name, setName] = useState('');
  const [level, setLevel] = useState<'personal' | 'project'>('personal');
  const { toolbar } = useEphemeralFilters();
  const ext = useListExt();
  const defs = useFilterDefsOfEntity(entity);
  const { data: definitions } = useCustomFieldDefinitions(entity === 'folder' ? 'node' : entity);
  const definitionList = useMemo(() => definitions ?? [], [definitions]);
  const groupFields = useMemo(
    () => groupFieldOptions(entity, definitionList),
    [entity, definitionList],
  );
  const numericFields = useMemo(
    () => numericFieldOptions(entity, definitionList),
    [entity, definitionList],
  );
  const createView = useCreateSavedView();
  const split = useMemo(
    () => splitAttributeFilter(toolbar.filters, definitionList),
    [toolbar.filters, definitionList],
  );

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createView.mutate(
      {
        name: trimmed,
        entity,
        scope: { kind: 'project', projectId },
        level,
        filter: split.predicates,
        sort: ext.sort,
        group: ext.group,
        totals: ext.totals,
        columns: [],
      },
      {
        onSuccess: (view) => {
          toast.success(ui.lists.panel.viewSaved, { description: view.name });
          onSaved(view);
          onOpenChange(false);
          setName('');
          setEntity('task');
          setLevel('personal');
          toolbar.resetAll();
          ext.reset();
        },
        onError: () => toast.error(t.saveTabError),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-full overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>{t.addListTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pb-4">
          <NodeLabel label={t.whatToShow} />
          <div className="grid grid-cols-3 gap-2">
            {ENTITY_CHOICES.map((choice) => (
              <button
                key={choice.entity}
                type="button"
                onClick={() => setEntity(choice.entity)}
                aria-pressed={entity === choice.entity}
                className={cn(
                  'flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors',
                  entity === choice.entity
                    ? 'border-ring bg-accent text-foreground'
                    : 'text-secondary-foreground hover:bg-accent/50',
                )}
              >
                <choice.icon className="size-4 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 truncate">{choice.label}</span>
              </button>
            ))}
          </div>

          {/* Та же панель фильтра, что в журналах: условия + группировка/итоги. */}
          <div className="overflow-hidden rounded-lg border border-border">
            <FilterPanel
              toolbar={toolbar}
              defs={defs as FilterFieldDef<never>[]}
              builtinPresets={[]}
              ext={{
                sections: (
                  <FilterPanelExtSections
                    state={ext}
                    groupFields={groupFields}
                    numericFields={numericFields}
                  />
                ),
                removedFieldIds: [...split.removedFieldIds],
                onReset: () => ext.reset(),
              }}
            />
          </div>

          <NodeLabel label={t.tabName} />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.tabNamePlaceholder}
            className="h-8"
          />
          {canManage ? (
            <>
              <NodeLabel label={t.access} />
              <div className="flex flex-col gap-1.5">
                {(['project', 'personal'] as const).map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="list-tab-level"
                      checked={level === value}
                      onChange={() => setLevel(value)}
                      className="size-4"
                    />
                    {value === 'project' ? t.accessProject : t.accessPersonal}
                  </label>
                ))}
              </div>
            </>
          ) : null}
          <p className="text-body-xs text-muted-foreground">{t.configure}</p>
          <div className="flex justify-end">
            <Button disabled={!name.trim() || createView.isPending} onClick={save}>
              {t.saveTab}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
