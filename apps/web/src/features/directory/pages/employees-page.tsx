import { AlertCircle, MoreHorizontal, Network, Search, UserPlus } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearch, useRouterState } from '@tanstack/react-router';
import type { DepartmentNode, OrgUnitKind, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@nodus/ui/components/empty';
import { Input } from '@nodus/ui/components/input';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';

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
import { flattenDepartments } from '../../../shared/api/departments-list.js';
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
  // пересчёт на resize. Ширина корня — для адаптивной шапки (ниже).
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const rootRef = useRef<HTMLDivElement>(null);
  const [topShift, setTopShift] = useState(0);
  const [rowWidth, setRowWidth] = useState(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    const update = () => {
      const axisY = measureCircuit(pathname, false)?.axisY;
      const rootTop = el?.getBoundingClientRect().top;
      setTopShift(axisY !== undefined && rootTop !== undefined ? axisY - rootTop : 0);
      setRowWidth(el?.clientWidth ?? 0);
    };
    update();
    const observer = el ? new ResizeObserver(update) : null;
    if (el) observer?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
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
  // Панель живёт только в «Подразделениях»: при уходе на другую вкладку
  // выбранный узел не должен оставлять резерв шапке (иначе шапка «Списка»
  // сдвигается влево без панели).
  const panelOpen = view === 'divisions' && selectedNode !== null;
  // Резерв шапки под панель (вердикт 24.09: инструменты не прячутся под неё).
  // Если места на полный ряд физически нет (узкое окно), резерв снимается —
  // панель ложится поверх шапки, как в окне структуры Битрикса; иначе
  // инструменты вылезали бы за мягкую раму. Порог 780 — ширина полного ряда
  // инструментов без поиска (наименьший неразрывный набор).
  const panelReserve = 424;
  const headerReserve = panelOpen ? (rowWidth - panelReserve >= 780 ? panelReserve : 24) : 24;
  // Узкая шапка: «Должности» и «Проверка данных» уезжают в тихое меню
  // (иначе ряд инструментов вылезает под панель/за раму).
  const compactActions = rowWidth - headerReserve < 1030;
  // Совсем узко: резерв под панель не помещается, панель ложится поверх шапки
  // (модель Битрикса) — тогда прячем инструменты, которые всё равно окажутся
  // под ней, вместо обрезанных полей. Остаются название и переключатель
  // структуры; поиск сотрудников и приглашение — в самой панели.
  const headerMinimal = panelOpen && rowWidth - panelReserve < 780;

  function openEmployee(user: UserListItem, rowEl: HTMLElement) {
    openCard({ kind: 'employee', id: user.id }, rowEl.getBoundingClientRect());
  }

  function openEmployeeById(id: string, source: DOMRect) {
    openCard({ kind: 'employee', id }, source);
  }

  return (
    // Панель НЕ двигает структуру: абсолютная область перекрывает канвас
    // поверх (модель Битрикса, вердикт 24.09), канвас остаётся во всю ширину.
    <div ref={rootRef} className="relative flex h-full flex-col">
      <div
        // Резерв ТОЛЬКО шапки: её инструменты не прячутся под панель, а канвас
        // остаётся во всю ширину — структура не двигается, панель перекрывает
        // её поверх (вердикт 24.09).
        style={{ paddingRight: headerReserve }}
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
                пилюлей + поиск рядом с ним, действия — справа (primary
                «Пригласить» крайний). */}
            {view === 'divisions' && (
              <StructureKindSwitcher
                kind={kind}
                onChange={(value) => {
                  setKind(value);
                  setSelectedDeptId(null);
                }}
              />
            )}
            {view === 'divisions' && !headerMinimal && (
              // Поиск — фиксированной ширины с правом сжиматься (до min-w-24):
              // при открытой панели шапка отдаёт место действиям, а не прячет их.
              <div className={cn('relative w-64 min-w-24 shrink', compactActions && 'max-w-48')}>
                <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={deptQuery}
                  onChange={(e) => setDeptQuery(e.target.value)}
                  placeholder={ui.common.search}
                  className="h-8 pl-7 text-sm"
                />
              </div>
            )}
            <span className="flex-1" />
            {!headerMinimal && (
              <>
                {canManage &&
                  (compactActions ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={ui.employees.structureActions}
                          title={ui.employees.structureActions}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setPositionsOpen(true)}>
                          {ui.employees.positions}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDataCheckOpen(true)}>
                          {ui.employees.dataCheck}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <>
                      <Button variant="outline" onClick={() => setPositionsOpen(true)}>
                        {ui.employees.positions}
                      </Button>
                      <Button variant="outline" onClick={() => setDataCheckOpen(true)}>
                        {ui.employees.dataCheck}
                      </Button>
                    </>
                  ))}
                <Button onClick={() => setInviteOpen(true)}>
                  <UserPlus data-icon="inline-start" />
                  {ui.employees.invite}
                </Button>
              </>
            )}
          </>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {view === 'divisions' ? (
          isLoading || tree.isLoading ? (
            <div className="flex flex-col items-center gap-10 p-6">
              <Skeleton className="h-28 w-60" />
              <div className="flex gap-4">
                <Skeleton className="h-28 w-60" />
                <Skeleton className="h-28 w-60" />
              </div>
            </div>
          ) : tree.isError ? (
            // Ошибка загрузки дерева — не пустой канвас (#441): сообщение и
            // повтор вместо молчаливой пустоты.
            <div className="flex h-full items-center justify-center p-6">
              <Empty className="max-w-sm">
                <EmptyMedia variant="icon">
                  <AlertCircle className="size-4" />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>{ui.employees.departmentsLoadError}</EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" size="sm" onClick={() => void tree.refetch()}>
                    {ui.employees.loadErrorRetry}
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          ) : roots.length === 0 ? (
            // Пустая структура (свежая установка): объясняем, что делать,
            // вместо пустого канваса.
            <div className="flex h-full items-center justify-center p-6">
              <Empty className="max-w-sm">
                <EmptyMedia variant="icon">
                  <Network className="size-4" />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>{ui.employees.noDepartments}</EmptyTitle>
                  <EmptyDescription>{ui.employees.noDepartmentsHint}</EmptyDescription>
                </EmptyHeader>
                {canManage ? (
                  <EmptyContent>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeptDialog({ open: true, parentId: null, editing: null })}
                    >
                      {ui.employees.createDepartment}
                    </Button>
                  </EmptyContent>
                ) : null}
              </Empty>
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
      <DataCheckDialog
        open={dataCheckOpen}
        onOpenChange={setDataCheckOpen}
        onOpenEmployee={(id, source) => {
          setDataCheckOpen(false);
          openEmployeeById(id, source);
        }}
      />
      <PositionsDialog open={positionsOpen} onOpenChange={setPositionsOpen} />
      <DepartmentDialog
        open={deptDialog.open}
        onOpenChange={(open) => setDeptDialog((prev) => ({ ...prev, open }))}
        kind={kind}
        parentId={deptDialog.parentId}
        editing={deptDialog.editing}
        users={items}
        departmentOptions={flattenDepartments(roots)}
      />
    </div>
  );
}
