import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { NodeKind, ProjectType } from '@nodus/contracts';
import { kindAllowedByType, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Plus } from 'lucide-react';

import { useOpenCard } from '../../../../app/shell/use-card-stack.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { DataTable, type DataTableField } from '../../../../shared/views/data-table.js';
import type { FilterFieldDef } from '../../../../shared/views/list-filters.js';
import { ListToolbar, ListToolbarSummary } from '../../../../shared/views/list-toolbar.js';
import { useListToolbar } from '../../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../../shared/views/view-settings.js';
import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { cn } from '@nodus/ui/lib/utils';
import { kindIdsAfterToggle, kindsSummary } from '../../lib/project-type-summary.js';
import { useUpdateProjectType } from '../../api/project-catalog-mutations.js';
import { CardTabToolbar } from '../../../../shared/ui/entity-card/card-tab-toolbar.js';

/** Ключ вида: колонки и ширины общие у всех типов папок (#857). */
const VIEW_KEY = 'processes.kind-usage';

/**
 * Раздел «Где используется» карточки типа папки (#857; ревизия UI v3) — СПИСОК
 * в грамматике журналов портала: типы проектов, где тип папки разрешён
 * (`kindIds`; `null` — все типы папок проекта), и состав папок типа проекта.
 * Read-only: связь настраивается на вкладке «Какие папки здесь бывают» типа
 * проекта; клик по строке открывает карточку этого типа проекта ПОВЕРХ с
 * анимацией из строки.
 * Тулбар — единый с соседними вкладками-списками (`ListToolbar`): слева
 * создание типа проекта и поиск (по названию типа проекта и сводке папок
 * строки), справа сводка «Проекты · N» (до поиска) и настройка колонок.
 */
export function NodeKindUsageSection({
  kind,
  renderProjectTypeCreate,
}: {
  kind: NodeKind;
  /** Окно создания типа проекта (слот фичи projects, I6): создан — этот тип
   *  папки сразу разрешён в нём. */
  renderProjectTypeCreate?: (slot: {
    onClose: () => void;
    onCreated: (id: string) => void;
    baseId?: string;
  }) => ReactNode;
}) {
  const typesQuery = useProjectTypes();
  const kindsQuery = useNodeKinds();
  const updateType = useUpdateProjectType();
  const openCard = useOpenCard();
  const openSettings = useTypeSettingsStore((s) => s.openSettings);
  const toolbar = useListToolbar(VIEW_KEY);
  const kinds = useMemo(() => kindsQuery.data ?? [], [kindsQuery.data]);
  const types = (typesQuery.data ?? []).filter((type) => type.archivedAt === null);
  const allowed = types.filter((type) => kindAllowedByType(type.kindIds, kind.id));
  const aliveKinds = useMemo(() => kinds.filter((item) => item.archivedAt === null), [kinds]);
  const [createOpen, setCreateOpen] = useState(false);
  // Новый тип проекта уже разрешает все типы папок (`kindIds: null`), но
  // основа-копия могла сузить список — дожидаемся записи и добавляем этот тип.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = pendingId ? types.find((type) => type.id === pendingId) : undefined;
  useEffect(() => {
    if (!pending) return;
    updateType.mutate({
      id: pending.id,
      kindIds: kindIdsAfterToggle(pending.kindIds, aliveKinds, kind.id, true),
    });
    setPendingId(null);
  }, [pending, aliveKinds, kind.id, updateType]);

  // Поиск — по названию типа проекта и по сводке папок его строки (как у
  // соседних вкладок-списков); сводка тулбара считает `allowed` — до поиска.
  const q = toolbar.query.trim().toLowerCase();
  const rows = allowed.filter(
    (type) =>
      !q ||
      type.name.toLowerCase().includes(q) ||
      kindsSummary(type, kinds).toLowerCase().includes(q),
  );
  // Пусто: поиск ничего не нашёл; иначе — как прежде: типов проектов нет
  // вовсе, либо этот тип папки не назначен ни одному.
  const emptyTitle = q
    ? ui.automation.entry.searchEmpty
    : types.length === 0
      ? ui.automation.creationScope.projectTypesEmpty
      : ui.nodeKinds.screen.usageEmpty;

  const defs = useMemo<DataTableField<(typeof allowed)[number]>[]>(
    () => [
      {
        id: 'name',
        label: ui.projects.fieldName,
        defaultVisible: true,
        defaultWidth: 300,
        minWidth: 180,
        maxWidth: 440,
        locked: true,
        render: (type) => (
          <>
            <span
              aria-hidden
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md border',
                identityTone[type.color].tile,
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
        id: 'kinds',
        label: ui.nodeKinds.title,
        defaultVisible: true,
        defaultWidth: 280,
        minWidth: 140,
        flex: true,
        render: (type) => (
          <span className="truncate text-sm text-muted-foreground">
            {kindsSummary(type, kinds)}
          </span>
        ),
        sortValue: (type) => kindsSummary(type, kinds),
      },
    ],
    [kinds],
  );

  return (
    <div className="@container relative flex h-full min-h-0 flex-col">
      <CardTabToolbar>
        <ListToolbar
          className="min-w-0 flex-1 px-0"
          toolbar={toolbar}
          defs={[] as FilterFieldDef<ProjectType>[]}
          left={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus data-icon="inline-start" />
              {ui.automation.entry.createProjectType}
            </Button>
          }
          right={
            <>
              <ListToolbarSummary>
                {ui.nodeKinds.screen.usageSummary.replace('{count}', String(allowed.length))}
              </ListToolbarSummary>
              <ViewSettings viewKey={VIEW_KEY} defs={defs} />
            </>
          }
        />
      </CardTabToolbar>
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey={VIEW_KEY}
          defs={defs}
          rows={rows}
          rowKey={(type) => type.id}
          label={ui.nodeKinds.screen.usage}
          selectable={false}
          emptyTitle={emptyTitle}
          onOpenRow={(type, rowEl) =>
            openCard({ kind: 'project-type', id: type.id }, rowEl.getBoundingClientRect())
          }
          rowMenu={(type) => [
            {
              id: 'open',
              label: ui.common.open,
              onSelect: () => openCard({ kind: 'project-type', id: type.id }),
            },
            {
              id: 'settings',
              label: ui.automation.menuSettingsType,
              onSelect: () => openSettings({ kind: 'project-type', id: type.id }),
            },
          ]}
        />
      </div>
      {createOpen && renderProjectTypeCreate
        ? renderProjectTypeCreate({
            onClose: () => setCreateOpen(false),
            onCreated: (id) => setPendingId(id),
          })
        : null}
    </div>
  );
}
