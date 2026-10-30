import { MoreHorizontal, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DepartmentNode, OrgUnitKind, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';

/**
 * Правая панель выбранного подразделения (#84, референс — правая колонка окна
 * структуры Битрикса): руководитель и зам (кликабельны — карточка сотрудника
 * в стеке, ADR-0009), сотрудники подразделения ТЕКУЩЕЙ структуры (поиск по
 * имени/должности), подчинённые руководителя по managerId — ВОЗМОЖНЫ из других
 * подразделений и это нормально (кейс «группы ГИПов», требование 1 #18).
 * Вталкивающая колонка: обёртка монтирована постоянно (w-0), раскрытие —
 * transition-[width] 200ms (закон выдвижных поверхностей, навык nodus-ui-style);
 * вертикальная граница — структурная линия зоны (канон сепараторов 24.09).
 */
export function DepartmentPanel({
  kind,
  node,
  users,
  topShift,
  onClose,
  onInvite,
  onCreateChild,
  onEdit,
}: {
  kind: OrgUnitKind;
  node: DepartmentNode | null;
  users: UserListItem[];
  /** Сдвиг верха панели к оси контура (axisY measureCircuit минус верх корня
   *  страницы, считает страница): верхняя граница идёт В ОДНУ ГОРИЗОНТАЛЬ со
   *  связью модуль→разделы (вердикт владельца 24.09) — вертикали бордера
   *  упираются в ось, геометрия замыкается. Панель — в потоке ряда: правый
   *  край ЧУТЬ левее границы мягкой рамы (mr 8), низ — mb 8 (вердикт 24.09). */
  topShift: number;
  onClose: () => void;
  onInvite: () => void;
  onCreateChild: (parentId: string) => void;
  onEdit: (node: DepartmentNode) => void;
}) {
  const openCard = useOpenCard();
  const [search, setSearch] = useState('');
  // Кэш последнего узла: контент не мигает пустотой на схлопывании.
  const [cached, setCached] = useState<DepartmentNode | null>(node);
  useEffect(() => {
    if (node) setCached(node);
  }, [node]);
  useEffect(() => {
    setSearch('');
  }, [node?.id]);

  const shown = node ?? cached;
  const members = useMemo(() => {
    if (!shown) return [];
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => (kind === 'management' ? u.departmentId : u.legalDepartmentId) === shown.id)
      .filter(
        (u) =>
          !q ||
          u.displayName.toLowerCase().includes(q) ||
          (u.positionName ?? '').toLowerCase().includes(q),
      );
  }, [shown, users, kind, search]);
  const reports = useMemo(
    () => (shown?.headId ? users.filter((u) => u.managerId === shown.headId) : []),
    [shown, users],
  );

  function personRow(person: UserListItem) {
    return (
      <button
        key={person.id}
        type="button"
        onClick={(e) =>
          openCard({ kind: 'employee', id: person.id }, e.currentTarget.getBoundingClientRect())
        }
        className="flex items-center gap-2.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-accent"
      >
        <PersonAvatar
          name={person.displayName}
          avatarUrl={person.avatarUrl}
          className="size-6 shrink-0"
        />
        <span className="min-w-0">
          <span className="block truncate text-sm">{person.displayName}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {person.positionName ?? ''}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      aria-hidden={node === null}
      style={{ top: topShift }}
      className={cn(
        // Дополнительная мягкая область с бордером по периметру (вердикт
        // владельца 24.09): absolute в корне страницы — верх ТОЧНО на
        // горизонтали оси контура (topShift = axisY − верх корня), правый край
        // чуть левее границы мягкой рамы (right 8), низ bottom 8; радиус
        // ступени поверхностей 14px; ширину резервирует padding корня, ширина
        // панели анимируется (закон выдвижных поверхностей).
        'absolute right-2 bottom-2 z-10 overflow-hidden transition-[width] duration-200 ease-out',
        node ? 'w-80' : 'w-0',
      )}
    >
      <div className="flex h-full w-80 flex-col gap-4 overflow-hidden rounded-[14px] border border-border bg-card p-4">
        {shown && (
          <>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-semibold">{shown.name}</h2>
                <span className="text-xs text-muted-foreground">
                  {kind === 'management' ? ui.employees.kindManagement : ui.employees.kindLegal}
                </span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={ui.employees.departmentActions}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onInvite}>
                    {ui.employees.inviteToDepartment}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onCreateChild(shown.id)}>
                    {ui.employees.addSubdepartment}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onEdit(shown)}>
                    {ui.employees.editDepartmentAction}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Крестик закрытия панели — У КРАЯ справа (вердикт 24.09). */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                aria-label={ui.common.close}
                onClick={onClose}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              <section className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {ui.employees.panelHead}
                </span>
                {shown.headId && shown.headName ? (
                  personRow(
                    users.find((u) => u.id === shown.headId) ?? {
                      id: shown.headId,
                      displayName: shown.headName,
                      status: 'active',
                      avatarUrl: null,
                      positionName: null,
                      departmentName: null,
                      email: '',
                      managerId: null,
                      departmentId: null,
                      legalDepartmentId: null,
                      positionId: null,
                      legalPositionId: null,
                    },
                  )
                ) : (
                  <span className="px-2 text-xs text-muted-foreground">{ui.common.notSet}</span>
                )}
              </section>
              {shown.deputyName && (
                <section className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {ui.employees.panelDeputy}
                  </span>
                  {personRow(
                    users.find((u) => u.id === shown.deputyId) ?? {
                      id: shown.deputyId ?? '',
                      displayName: shown.deputyName,
                      status: 'active',
                      avatarUrl: null,
                      positionName: null,
                      departmentName: null,
                      email: '',
                      managerId: null,
                      departmentId: null,
                      legalDepartmentId: null,
                      positionId: null,
                      legalPositionId: null,
                    },
                  )}
                </section>
              )}
            </div>
            <section className="flex min-h-0 flex-1 flex-col gap-2">
              <NodeLabel label={ui.employees.panelMembers} count={members.length} />
              <div className="relative">
                <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={ui.employees.searchMembers}
                  className="h-8 pl-7 text-sm"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {members.length > 0 ? (
                  <div className="flex flex-col gap-0.5">{members.map(personRow)}</div>
                ) : (
                  <span className="px-2 text-sm text-muted-foreground">
                    {ui.employees.emptyDepartment}
                  </span>
                )}
              </div>
            </section>
            {reports.length > 0 && (
              <section className="flex shrink-0 flex-col gap-1.5">
                <NodeLabel label={ui.employees.panelReports} count={reports.length} />
                <div className="flex flex-col gap-0.5">{reports.map(personRow)}</div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
