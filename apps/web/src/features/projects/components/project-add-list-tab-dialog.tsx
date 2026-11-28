import { useEffect, useMemo, useRef, useState } from 'react';
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
import { predicatesToFilterState } from '../../../shared/views/list-ext/predicates-to-filter-state.js';
import { useListExt } from '../../../shared/views/list-ext/use-list-ext.js';
import {
  useCreateSavedView,
  useUpdateSavedView,
} from '../../../shared/views/list-ext/saved-views-api.js';
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
 * Окно вкладки-списка проекта (#435): создание («+» полосы вкладок →
 * «Новый список») и правка настроек существующей (карандаш тулбара вкладки):
 * что показывать (задачи этого проекта / письма / папки) → та же панель
 * фильтра, что в журналах (условия, колонки задаются шестерёнкой вкладки,
 * группировка, итоги) → название и доступ (общая проектная — руководство,
 * личная — себе) → «Сохранить вкладкой». В правке сущность и уровень не
 * меняются (рамка и права — место хранения), патчится всё остальное.
 * Рамку проекта окно не предлагает снять — условий projectId в панели нет.
 */
export function ProjectAddListTabDialog({
  projectId,
  canManage,
  editView,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  /** Руководство проекта: может сохранить общую вкладку (сервер решает). */
  canManage: boolean;
  /** Правка существующего списка: подставить его настройки, PATCH вместо POST. */
  editView?: SavedView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (view: SavedView) => void;
}) {
  const t = ui.lists.tabs;
  const [entity, setEntity] = useState<ListEntity>(editView?.entity ?? 'task');
  const [name, setName] = useState(editView?.name ?? '');
  const [level, setLevel] = useState<'personal' | 'project'>(
    editView?.level === 'project' ? 'project' : 'personal',
  );
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
  const updateView = useUpdateSavedView();
  const split = useMemo(
    () => splitAttributeFilter(toolbar.filters, definitionList),
    [toolbar.filters, definitionList],
  );

  // Правка: подставить настройки существующего списка (условия в форму
  // панели, сортировку/группировку/итоги — в состояние расширения).
  useEffect(() => {
    if (!open || !editView) return;
    toolbar.setFilters(predicatesToFilterState(editView.filter));
    ext.applyViewExt(editView);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- подстановка при открытии
  }, [open, editView]);

  // Смена «что показывать» — новый список: прежние условия принадлежат
  // другой сущности и не переносятся (иначе атрибут задач у писем читался
  // бы «удалённым» — волна владельца 28.11).
  const entityRef = useRef(entity);
  useEffect(() => {
    if (entityRef.current === entity) return;
    entityRef.current = entity;
    toolbar.resetAll();
    ext.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только смена сущности
  }, [entity]);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Правка существующего: рамку/уровень/сущность не трогаем (место
    // хранения и права), патчим имя и настройки выборки.
    if (editView) {
      updateView.mutate(
        {
          id: editView.id,
          body: {
            name: trimmed,
            filter: split.predicates,
            sort: ext.sort,
            group: ext.group ?? null,
            totals: ext.totals,
          },
        },
        {
          onSuccess: (view) => {
            toast.success(t.changesSaved, { description: view.name });
            onSaved(view);
            onOpenChange(false);
          },
          onError: () => toast.error(t.saveTabEditError),
        },
      );
      return;
    }
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
      {/* Высота ФИКСИРОВАННАЯ (канон многошаговых окон): шапка/футер и кнопки
          не меняют положения при смене «что показывать» — растёт только
          скроллящееся тело. */}
      <DialogContent className="flex h-[85vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {/* h-11 — центр строки совпадает с центром крестика окна (top-2 +
            icon-sm 28px → 22px), волна владельца: «выровнять по крестику». */}
        <DialogHeader className="flex h-11 shrink-0 flex-row items-center border-b border-border px-4">
          <DialogTitle className="text-base font-semibold">
            {editView ? t.editListTitle : t.addListTitle}
          </DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          {/* Выбор сущности — только созданию: у существующего списка сущность
              менять нельзя (рамка и настройки принадлежат ей). */}
          {editView ? null : (
            <>
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
            </>
          )}

          {/* Та же панель фильтра, что в журналах: условия + группировка/итоги.
              shrink-0 обязателен: flex-body иначе СЖИМАЕТ панель до огрызка,
              а обёртка с overflow-hidden режет нижние поля без всякого
              скролла (волна владельца 28.11); при природной высоте панели
              переполняется и скроллится ТЕЛО окна. */}
          <div className="shrink-0 overflow-hidden rounded-lg border border-border">
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
          {/* Уровень доступа — только созданию: у существующего списка уровень
              не меняется (права и место хранения). */}
          {canManage && !editView ? (
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
        </div>
        {/* Футер закреплён (канон окна-пикера): длинная панель фильтра
            скроллится телом, кнопка сохранения всегда доступна. */}
        <div className="flex h-14 shrink-0 items-center justify-end gap-2 border-t border-border px-4">
          <Button
            disabled={!name.trim() || (editView ? updateView : createView).isPending}
            onClick={save}
          >
            {editView ? t.saveTabEdit : t.saveTab}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
