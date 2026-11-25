import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouterState, useSearch } from '@tanstack/react-router';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useHeaderGeometry } from '../lib/use-header-geometry.js';
import { activeStaffCount } from '../../../shared/lib/staff-count.js';
import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { DataTable } from '../../../shared/views/data-table.js';
import { makeCardRowMenuItems } from '../../../shared/views/card-row-menu.js';
import {
  employeeSearchText,
  useEmployeeFilterDefs,
} from '../../../shared/views/employee-filter-fields.js';
import type { ActiveListFilter } from '../../../shared/views/list-filters.js';
import { useFilteredList, useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { useDepartmentTree, useUsersList } from '../api/directory-api.js';
import { flattenDepartments } from '../../../shared/api/departments-list.js';
import { DepartmentActionDialogs } from '../components/department-action-dialogs.js';
import { DepartmentDialog } from '../components/department-dialog.js';
import { DepartmentPanel } from '../components/department-panel.js';
import type { StructureFocus } from '../components/divisions-view.js';
import { EmployeesPageHeader } from '../components/employees-page-header.js';
import { EmployeesStructureCanvas } from '../components/employees-structure-canvas.js';
import { InviteDialog } from '../components/invite-dialog.js';
import { PositionsPanel } from '../components/positions-panel.js';
import { buildDepartmentCardStats } from '../lib/department-card-stats.js';
import { findDepartment } from '../lib/department-tree.js';
import { employeeListFields } from '../lib/employee-fields.js';
import { resolveEmployeesTab, type EmployeesTab } from '../lib/employees-tab.js';
import {
  activeDepartmentIds,
  mainDepartmentId,
  structureDepartmentOf,
} from '../lib/structure-search.js';
import { useCanonicalEmployeesView } from '../lib/use-canonical-employees-view.js';
import { useCanManageDirectory } from '../lib/use-can-manage-directory.js';

type RightPanel = 'dept' | 'positions';

/**
 * Сотрудники (#768, вердикты 12–13.11.2026): «Список» (дефолт, каноническая
 * таблица) и «Структура» (управленческое дерево, главная карточка компании,
 * постоянная правая панель отдела/должностей). Панель ПОСТОЯННА, как в
 * Битриксе: клик по карточке только выбирает отдел, «Должности»
 * подменяют содержимое — канвас и шапка не сдвигаются. Старые адреса
 * нормализуются заменой URL; карточка сотрудника — стек карточек (ADR-0009).
 * Страница держит композицию вкладок и оверлеев; шапки — `employees-page-header`,
 * канвас — `employees-structure-canvas` (I5).
 */
export function EmployeesPage() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const rawView = typeof search.view === 'string' ? search.view : undefined;
  const tab: EmployeesTab = resolveEmployeesTab(rawView);
  const { data, isLoading } = useUsersList();
  const openCard = useOpenCard();
  const me = useAuthStore((s) => s.user);
  const tree = useDepartmentTree('management');
  const [rightPanel, setRightPanel] = useState<RightPanel>('dept');
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [focus, setFocus] = useState<StructureFocus | null>(null);
  const [highlightUserId, setHighlightUserId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteDepartmentId, setInviteDepartmentId] = useState<string | null>(null);
  const [transferNode, setTransferNode] = useState<DepartmentNode | null>(null);
  const [deleteNode, setDeleteNode] = useState<DepartmentNode | null>(null);
  const canManage = useCanManageDirectory();
  const focusToken = useRef(0);
  const enteredStructure = useRef(false);
  const [deptDialog, setDeptDialog] = useState<{
    open: boolean;
    parentId: string | null;
    editing: DepartmentNode | null;
  }>({ open: false, parentId: null, editing: null });

  // Верх панели — в одну горизонталь с осью контура, ширина корня — для
  // адаптивной шапки (хук `useHeaderGeometry`, #441).
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { rootRef, topShift, rowWidth } = useHeaderGeometry(pathname);

  // Старые адреса нормализуются заменой URL (хук `useCanonicalEmployeesView`).
  useCanonicalEmployeesView(rawView);

  const toolbar = useListToolbar('directory.employees');
  const filterDefs = useEmployeeFilterDefs();
  const items = useMemo(() => data?.items ?? [], [data]);
  // Счётчик шапки — штат, а не длина выдачи (#723): уволенные остаются в
  // журнале (их карточки открываются из упоминаний и истории), но не в числе.
  const staffCount = useMemo(() => activeStaffCount(items), [items]);
  const meItem = useMemo(() => items.find((user) => user.id === me?.id), [items, me]);
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

  const roots = useMemo(() => tree.data ?? [], [tree.data]);
  const activeIds = useMemo(() => activeDepartmentIds(roots), [roots]);
  const mainId = useMemo(() => mainDepartmentId(roots), [roots]);
  const departmentOptions = useMemo(() => flattenDepartments(roots), [roots]);
  // Карточки структуры (руководитель/замы/подчинённые/чип) — ОДИН расчёт на
  // страницу из уже загруженного справочника (план 16.11.2026, §2).
  const cardStats = useMemo(
    () => buildDepartmentCardStats(roots, items, { mainId, activeDepartmentIds: activeIds }),
    [roots, items, mainId, activeIds],
  );
  const selectedNode = selectedDeptId ? findDepartment(roots, selectedDeptId) : null;
  const positionsOpen = tab === 'structure' && rightPanel === 'positions';
  const deptOpen = tab === 'structure' && !positionsOpen && selectedNode !== null;
  // Бейдж «Ваше подразделение»: свой активный отдел, иначе главная карточка —
  // сотрудник без подразделения (или с архивным) показан там, и бейдж видят все
  // (вердикт 17.11.2026). Нет дерева/меня — бейджа нет.
  const myDepartmentId = useMemo(
    () => (meItem ? structureDepartmentOf(meItem, activeIds, mainId) : null),
    [meItem, activeIds, mainId],
  );

  const enterStructure = useCallback(() => {
    const mine = myDepartmentId;
    const previous =
      selectedDeptId && findDepartment(roots, selectedDeptId) ? selectedDeptId : null;
    // Панель постоянна — у неё всегда есть содержимое: ранее выбранный
    // отдел, мой, главная карточка, первый корень.
    const target = previous ?? mine ?? mainId ?? roots[0]?.id ?? null;
    focusToken.current += 1;
    setSelectedDeptId(target);
    setRightPanel('dept');
    setFocus({ id: target, token: focusToken.current });
  }, [myDepartmentId, selectedDeptId, roots, mainId]);

  // Вход на вкладку «Структура» — один раз на вход: мой отдел (или
  // ранее выбранное) центрируется, его панель открыта. Возврат с «Списка»
  // повторяет центрирование; фоновые рефетчи дерева его не дёргают.
  useEffect(() => {
    if (tab !== 'structure') {
      enteredStructure.current = false;
      return;
    }
    if (enteredStructure.current || isLoading || tree.isLoading || tree.isError || !tree.data) {
      return;
    }
    enteredStructure.current = true;
    enterStructure();
  }, [tab, isLoading, tree.isLoading, tree.isError, tree.data, enterStructure]);

  function centerOn(id: string | null) {
    focusToken.current += 1;
    setFocus({ id, token: focusToken.current });
  }

  /** Клик по карточке только выбирает отдел: панель постоянна и не
   *  скрывается повторным кликом, канвас не перецентрируется (Битрикс). */
  function selectDepartment(id: string) {
    setSelectedDeptId(id);
    setRightPanel('dept');
    setHighlightUserId(null);
  }

  function pickDepartment(id: string) {
    setSelectedDeptId(id);
    setRightPanel('dept');
    setHighlightUserId(null);
    centerOn(id);
  }

  function pickEmployee(user: UserListItem) {
    const departmentId = structureDepartmentOf(user, activeIds, mainId);
    if (!departmentId) return;
    setSelectedDeptId(departmentId);
    setRightPanel('dept');
    setHighlightUserId(user.id);
    centerOn(departmentId);
  }

  function openEmployee(user: UserListItem, rowEl: HTMLElement) {
    openCard({ kind: 'employee', id: user.id }, rowEl.getBoundingClientRect());
  }

  return (
    <div ref={rootRef} data-employees-page className="relative flex h-full flex-col">
      <EmployeesPageHeader
        structure={tab === 'structure'}
        staffCount={staffCount}
        rowWidth={rowWidth}
        canManage={canManage}
        positionsOpen={positionsOpen}
        roots={roots}
        users={items}
        toolbar={toolbar}
        filterDefs={filterDefs}
        defs={defs}
        onInvite={() => {
          setInviteDepartmentId(null);
          setInviteOpen(true);
        }}
        onTogglePositions={() =>
          setRightPanel((prev) => (prev === 'positions' ? 'dept' : 'positions'))
        }
        onPickDepartment={pickDepartment}
        onPickEmployee={pickEmployee}
      />
      <div className="min-h-0 flex-1">
        {tab === 'list' ? (
          <DataTable
            viewKey="directory.employees"
            /* Массовых действий нет — выбор строк не предлагаем (#962). */
            selectable={false}
            defs={defs}
            rows={rows}
            rowKey={(user) => user.id}
            isLoading={isLoading}
            onOpenRow={openEmployee}
            rowMenu={(user) =>
              makeCardRowMenuItems({ kind: 'employee', id: user.id }, openCard, {
                openLabel: ui.employees.openProfile,
              })
            }
          />
        ) : (
          <EmployeesStructureCanvas
            loading={isLoading || tree.isLoading}
            error={tree.isError}
            roots={roots}
            selectedDeptId={selectedDeptId}
            mainId={mainId}
            myDepartmentId={myDepartmentId}
            focus={focus}
            canManage={canManage}
            statsById={cardStats}
            onRetry={() => void tree.refetch()}
            onCreateDepartment={() => setDeptDialog({ open: true, parentId: null, editing: null })}
            onSelect={selectDepartment}
            onCreateChild={(parentId) => setDeptDialog({ open: true, parentId, editing: null })}
            onInvite={(node) => {
              setInviteDepartmentId(node.id);
              setInviteOpen(true);
            }}
            onEdit={(node) => setDeptDialog({ open: true, parentId: null, editing: node })}
            onTransfer={setTransferNode}
            onDelete={setDeleteNode}
            onLocateMe={meItem ? () => pickEmployee(meItem) : undefined}
          />
        )}
      </div>
      {deptOpen && selectedNode ? (
        <DepartmentPanel
          mainCard={selectedDeptId === mainId}
          node={selectedNode}
          users={items}
          activeDepartmentIds={activeIds}
          highlightUserId={highlightUserId}
          topShift={topShift}
          onInvite={(departmentId) => {
            setInviteDepartmentId(departmentId);
            setInviteOpen(true);
          }}
          onEdit={(node) => setDeptDialog({ open: true, parentId: null, editing: node })}
          onTransfer={setTransferNode}
          onDelete={setDeleteNode}
          canManage={canManage}
        />
      ) : null}
      {positionsOpen ? (
        <PositionsPanel
          users={items}
          topShift={topShift}
          canManage={canManage}
          onClose={() => setRightPanel('dept')}
        />
      ) : null}
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        initialDepartmentId={inviteDepartmentId}
      />
      <DepartmentActionDialogs
        transferNode={transferNode}
        deleteNode={deleteNode}
        roots={roots}
        users={items}
        departmentOptions={departmentOptions}
        onTransferOpenChange={(open) => {
          if (!open) setTransferNode(null);
        }}
        onDeleteOpenChange={(open) => {
          if (!open) setDeleteNode(null);
        }}
        onMoved={(node, userId) => {
          setSelectedDeptId(node.id);
          setRightPanel('dept');
          setHighlightUserId(userId);
          centerOn(node.id);
        }}
        onDeleted={(parentId) => {
          setSelectedDeptId(parentId);
          setRightPanel('dept');
          setHighlightUserId(null);
          centerOn(parentId);
          setDeleteNode(null);
        }}
      />
      <DepartmentDialog
        open={deptDialog.open}
        onOpenChange={(open) => setDeptDialog((prev) => ({ ...prev, open }))}
        kind="management"
        parentId={deptDialog.parentId}
        editing={deptDialog.editing}
        users={items}
        departmentOptions={departmentOptions}
      />
    </div>
  );
}
