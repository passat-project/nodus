import { Search, UserPlus } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearch, useRouterState } from '@tanstack/react-router';
import type { DepartmentNode, OrgUnitKind, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { measureCircuit } from '../../../app/shell/circuit-geometry.js';
import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { DataTable } from '../../../shared/views/data-table.js';
import { makeCardRowMenuItems } from '../../../shared/views/card-row-menu.js';
import {
  employeeSearchText,
  useEmployeeFilterDefs,
} from '../../../shared/views/employee-filter-fields.js';
import type { ActiveListFilter } from '../../../shared/views/list-filters.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import { useFilteredList, useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { useDepartmentTree, useUsersList } from '../api/directory-api.js';
import { DataCheckDialog } from '../components/data-check-dialog.js';
import { DepartmentDialog } from '../components/department-dialog.js';
import { DepartmentPanel } from '../components/department-panel.js';
import { DivisionsView } from '../components/divisions-view.js';
import { InviteDialog } from '../components/invite-dialog.js';
import { PositionsDialog } from '../components/positions-dialog.js';
import { StructureKindSwitcher } from '../components/structure-kind-switcher.js';
import { SubordinationView } from '../components/subordination-view.js';
import { findDepartment } from '../lib/department-tree.js';
import { employeeListFields } from '../lib/employee-fields.js';
import { useCanManageDirectory } from '../lib/use-can-manage-directory.js';

type StructureView = 'divisions' | 'subordination' | 'list';

/**
 * Сотрудники (#84, вердикты владельца 23–24.09): три вида — «Подразделения»
 * (дефолт: дерево карточек подразделений + правая панель выбранного,
 * переключатель управленческая/юридическая; сотни карточек людей на канвасе
 * не бывает), «Подчинённость» (фокус-граф по managerId вокруг сотрудника)
 * и «Список» (каноническая таблица shared/views, ключ `directory.employees`).
 * Виды — вкладки топбара (search-параметр view, nav-registry). Открытие
 * карточки сотрудника — стек карточек из rect источника (ADR-0009).
 */
export function EmployeesPage() {
  const search = useSearch({ strict: false }) as { view?: string };
  const view: StructureView =
    search.view === 'list'
      ? 'list'
      : search.view === 'subordination'
        ? 'subordination'
        : 'divisions';
  const { data, isLoading } = useUsersList();
  const openCard = useOpenCard();
  const me = useAuthStore((s) => s.user);
  const [kind, setKind] = useState<OrgUnitKind>('management');
  const tree = useDepartmentTree(kind);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [deptQuery, setDeptQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [dataCheckOpen, setDataCheckOpen] = useState(false);
  const [positionsOpen, setPositionsOpen] = useState(false);
  const canManage = useCanManageDirectory();
  const [deptDialog, setDeptDialog] = useState<{
    open: boolean;
    parentId: string | null;
    editing: DepartmentNode | null;
  }>({ open: false, parentId: null, editing: null });

  // Верх панели подразделения — В ОДНУ ГОРИЗОНТАЛЬ с осью контура (связь
  // модуль→разделы): мера из того же источника, что рисует контур
  // (measureCircuit.axisY), минус верх корня страницы = сдвиг верха панели;
  // пересчёт на resize. Панель в потоке ряда — правый край внутри мягкой рамы.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const rootRef = useRef<HTMLDivElement>(null);
  const [topShift, setTopShift] = useState(0);
  useLayoutEffect(() => {
    const update = () => {
      const axisY = measureCircuit(pathname, false)?.axisY;
      const rootTop = rootRef.current?.getBoundingClientRect().top;
      setTopShift(axisY !== undefined && rootTop !== undefined ? axisY - rootTop : 0);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [pathname]);

  const toolbar = useListToolbar('directory.employees');
  const filterDefs = useEmployeeFilterDefs();
  const items = useMemo(() => data?.items ?? [], [data]);
  const filter = useMemo<ActiveListFilter<UserListItem>>(
    () => ({
      defs: filterDefs,
      state: toolbar.filters,
      query: toolbar.query,
      searchText: employeeSearchText,
    }),
    [filterDefs, toolbar.filters, toolbar.query],
  );
  const rows = useFilteredList(items, filter);
  const byId = useMemo(() => new Map(items.map((user) => [user.id, user] as const)), [items]);
  const defs = useMemo(() => employeeListFields(byId), [byId]);

  const roots = tree.data ?? [];
  const selectedNode = selectedDeptId ? findDepartment(roots, selectedDeptId) : null;

  function openEmployee(user: UserListItem, rowEl: HTMLElement) {
    openCard({ kind: 'employee', id: user.id }, rowEl.getBoundingClientRect());
  }

  return (
    // Панель НЕ двигает структуру: абсолютная область перекрывает канвас
    // поверх (модель Битрикса, вердикт 24.09), канвас остаётся во всю ширину.
    <div ref={rootRef} className="relative flex h-full flex-col">
      <div
        // Резерв ТОЛЬКО шапки: её инструменты не прячутся под панель, а канвас
        // остаётся во всю ширину — структура не двигается, панель перекрывает
        // её поверх (вердикт 24.09).
        style={{ paddingRight: selectedNode ? 424 : 24 }}
        className="flex h-14 shrink-0 items-center gap-3 pl-6 transition-[padding] duration-200 ease-out"
      >
        <h1 className="shrink-0 text-xl font-semibold text-balance text-foreground">
          {ui.employees.title}
          <span className="ml-2 align-middle font-mono text-label-lg font-normal text-muted-foreground tabular-nums">
            {items.length}
          </span>
        </h1>
        {view === 'list' ? (
          <ListToolbar
            className="min-w-0 flex-1 px-0"
            toolbar={toolbar}
            defs={filterDefs}
            left={
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus data-icon="inline-start" />
                {ui.employees.invite}
              </Button>
            }
            right={<ViewSettings viewKey="directory.employees" defs={defs} />}
          />
        ) : (
          <>
            {/* Образец шапки корреспонденции (вердикт 24.09): переключатель
                пилюлей + кнопка создания СЛЕВА в строке инструментов, правый
                угол шапки свободен. */}
            {view === 'divisions' && (
              <StructureKindSwitcher
                kind={kind}
                onChange={(value) => {
                  setKind(value);
                  setSelectedDeptId(null);
                }}
              />
            )}
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus data-icon="inline-start" />
              {ui.employees.invite}
            </Button>
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={() => setPositionsOpen(true)}>
                  {ui.employees.positions}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDataCheckOpen(true)}>
                  {ui.employees.dataCheck}
                </Button>
              </>
            )}
            {view === 'divisions' && (
              // Поиск гибкий (flex-1 с пределами): при открытой панели шапка
              // сжимается, не пряча «Найти меня» под панель.
              <div className="relative max-w-64 min-w-32 flex-1">
                <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={deptQuery}
                  onChange={(e) => setDeptQuery(e.target.value)}
                  placeholder={ui.employees.searchDepartments}
                  className="h-8 pl-7 text-sm"
                />
              </div>
            )}
            <span className="flex-1" />
          </>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {view === 'divisions' ? (
          isLoading || tree.isLoading ? (
            <div className="flex flex-col items-center gap-6 p-6">
              <Skeleton className="h-20 w-60" />
              <div className="flex gap-4">
                <Skeleton className="h-20 w-60" />
                <Skeleton className="h-20 w-60" />
              </div>
            </div>
          ) : tree.isError ? (
            // Ошибка загрузки дерева — не пустой канвас (#441): сообщение и
            // повтор вместо молчаливой пустоты.
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <p className="text-sm text-muted-foreground">{ui.common.loadError}</p>
              <Button variant="outline" size="sm" onClick={() => void tree.refetch()}>
                {ui.employees.loadErrorRetry}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex h-full min-h-0">
                <div className="min-w-0 flex-1">
                  <DivisionsView
                    roots={roots}
                    selectedId={selectedDeptId}
                    onSelect={(id) => setSelectedDeptId(id === selectedDeptId ? null : id)}
                    query={deptQuery}
                  />
                </div>
              </div>
              <DepartmentPanel
                kind={kind}
                node={selectedNode}
                users={items}
                topShift={topShift}
                onClose={() => setSelectedDeptId(null)}
                onInvite={() => setInviteOpen(true)}
                onCreateChild={(parentId) => setDeptDialog({ open: true, parentId, editing: null })}
                onEdit={(node) => setDeptDialog({ open: true, parentId: null, editing: node })}
              />
            </>
          )
        ) : view === 'subordination' ? (
          <SubordinationView people={items} meId={me?.id ?? ''} />
        ) : (
          <DataTable
            viewKey="directory.employees"
            defs={defs}
            rows={rows}
            rowKey={(user) => user.id}
            isLoading={isLoading}
            onOpenRow={openEmployee}
            rowMenu={(user) => makeCardRowMenuItems({ kind: 'employee', id: user.id }, openCard)}
          />
        )}
      </div>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <DataCheckDialog open={dataCheckOpen} onOpenChange={setDataCheckOpen} />
      <PositionsDialog open={positionsOpen} onOpenChange={setPositionsOpen} />
      <DepartmentDialog
        open={deptDialog.open}
        onOpenChange={(open) => setDeptDialog((prev) => ({ ...prev, open }))}
        kind={kind}
        parentId={deptDialog.parentId}
        editing={deptDialog.editing}
        users={items}
      />
    </div>
  );
}
