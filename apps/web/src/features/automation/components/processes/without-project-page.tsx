import { useEffect, useMemo, useState } from 'react';
import type { ProcessType } from '@nodus/contracts';
import { typeConfigOf, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Switch } from '@nodus/ui/components/switch';
import { cn } from '@nodus/ui/lib/utils';
import { Plus } from 'lucide-react';

import { useOpenCard } from '../../../../app/shell/use-card-stack.js';
import {
  useLiveProcessTypes,
  useUpdateTypeCreation,
} from '../../../../shared/api/process-types-api.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';
import { PanelNote } from '../../../../shared/ui/panel/panel-kit.js';
import { TypeCardFrame } from '../../../../shared/ui/type-card-frame.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { typeToneOf } from '../../../../shared/workflow/type-tone.js';
import { DataTable, type DataTableField } from '../../../../shared/views/data-table.js';
import type { FilterFieldDef } from '../../../../shared/views/list-filters.js';
import { ListToolbar, ListToolbarSummary } from '../../../../shared/views/list-toolbar.js';
import { useListToolbar } from '../../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../../shared/views/view-settings.js';
import { ProcessTypeCreateDialog } from '../types/type-create-dialog.js';

/** Ключ вида: колонки и ширины общие у всех типов проекта (#857). */
const VIEW_KEY = 'processes.no-project';

/**
 * «Без проекта» в разделе «Процессы» (#857, единая модель §4; ревизия UI v3) —
 * ТА ЖЕ рама карточки, что у типа проекта/папки, без вкладок: бар несёт
 * строку инструментов списка (главная кнопка слева от поиска, сводка
 * «Включено: N из M» и шестерёнка вида — справа). Список типов, которые можно
 * ставить без проекта, — в грамматике журналов портала, без чекбоксов и
 * островка пакетных команд: тумблер — элемент строки, клик по строке открывает
 * карточку типа задачи ПОВЕРХ с анимацией из строки. Запись — через настройку
 * самого типа (`creation.withoutProject`, вторая сторона — «Где создаётся»).
 * Без права `workflow.manage` — только просмотр с пояснением (паттерн #665, I8).
 */
export function WithoutProjectPage({ canManage }: { canManage: boolean }) {
  const tasks = useLiveProcessTypes('task');
  const update = useUpdateTypeCreation();
  const toolbar = useListToolbar(VIEW_KEY);
  const openCard = useOpenCard();
  const openSettings = useTypeSettingsStore((s) => s.openSettings);
  const rows = useMemo(() => tasks.data ?? [], [tasks.data]);
  const enabled = rows.filter((type) => typeConfigOf(type).creation.withoutProject).length;
  const [createOpen, setCreateOpen] = useState(false);
  // Созданный тип дожидаемся в живых данных: включаем его в «Без проекта»
  // (остальную настройку основы-копии не перезаписываем).
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = pendingId ? rows.find((type) => type.id === pendingId) : undefined;
  useEffect(() => {
    if (!pending) return;
    const scope = typeConfigOf(pending).creation;
    update.mutate({ typeId: pending.id, creation: { ...scope, withoutProject: true } });
    setPendingId(null);
  }, [pending, update]);

  const q = toolbar.query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter(
        (type) =>
          !q ||
          type.name.toLowerCase().includes(q) ||
          (type.description ?? '').toLowerCase().includes(q),
      ),
    [rows, q],
  );

  function toggle(
    typeId: string,
    scope: ReturnType<typeof typeConfigOf>['creation'],
    value: boolean,
  ) {
    update.mutate({ typeId, creation: { ...scope, withoutProject: value } });
  }

  const defs = useMemo<DataTableField<ProcessType>[]>(
    () => [
      {
        id: 'name',
        label: ui.projects.fieldName,
        defaultVisible: true,
        defaultWidth: 260,
        minWidth: 170,
        maxWidth: 300,
        locked: true,
        render: (type) => (
          <>
            <span
              aria-hidden
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md border',
                typeToneOf(type.color),
              )}
            >
              <ProcessTypeGlyph icon={type.icon} className="size-3.5" />
            </span>
            <span className="truncate text-sm font-medium">{type.name}</span>
          </>
        ),
        sortValue: (type) => type.name,
      },
      {
        id: 'description',
        label: ui.projects.fieldDescription,
        defaultVisible: true,
        defaultWidth: 280,
        minWidth: 160,
        maxWidth: 280,
        flex: true,
        render: (type) =>
          type.description ? (
            <span className="truncate text-sm text-muted-foreground" title={type.description}>
              {type.description}
            </span>
          ) : null,
        sortValue: (type) => type.description ?? '',
      },
    ],
    [],
  );

  return (
    <TypeCardFrame
      bar={
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={[] as FilterFieldDef<ProcessType>[]}
          left={
            canManage ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus data-icon="inline-start" />
                {ui.automation.entry.createTaskType}
              </Button>
            ) : undefined
          }
          right={
            <>
              <ListToolbarSummary>
                {ui.automation.entry.noProjectSummary
                  .replace('{enabled}', String(enabled))
                  .replace('{total}', String(rows.length))}
              </ListToolbarSummary>
              <ViewSettings viewKey={VIEW_KEY} defs={defs} />
            </>
          }
        />
      }
    >
      <>
        <div className="relative flex h-full min-h-0 flex-col">
          {!canManage ? (
            <div className="px-6 pt-2">
              <PanelNote>{ui.automation.creationScope.noWorkflowPermission}</PanelNote>
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
            <DataTable
              viewKey={VIEW_KEY}
              defs={defs}
              rows={filtered}
              rowKey={(type) => type.id}
              selectable={false}
              label={ui.automation.creationScope.tasksGroup}
              emptyTitle={q ? ui.automation.entry.searchEmpty : ui.automation.entry.noProjectEmpty}
              onOpenRow={(type, rowEl) =>
                openCard({ kind: 'process-type', id: type.id }, rowEl.getBoundingClientRect())
              }
              rowMenu={(type) => [
                {
                  id: 'open',
                  label: ui.common.open,
                  onSelect: () => openCard({ kind: 'process-type', id: type.id }),
                },
                {
                  id: 'settings',
                  label: ui.automation.menuSettingsType,
                  onSelect: () => openSettings({ kind: 'process-type', id: type.id }),
                },
              ]}
              actions={(type) => {
                const scope = typeConfigOf(type).creation;
                return (
                  <Switch
                    checked={scope.withoutProject}
                    disabled={!canManage || update.isPending}
                    aria-label={`${type.name}: ${ui.automation.entry.noProjectToggle}`}
                    onCheckedChange={(checked) => toggle(type.id, scope, checked)}
                  />
                );
              }}
            />
          </div>
        </div>
        {createOpen ? (
          <ProcessTypeCreateDialog
            onClose={() => setCreateOpen(false)}
            onCreated={(id) => setPendingId(id)}
          />
        ) : null}
      </>
    </TypeCardFrame>
  );
}
