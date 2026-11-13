import { MoreHorizontal, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DepartmentNode, OrgUnitKind, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@nodus/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { activeStaffCount } from '../../../shared/lib/staff-count.js';
import { useArchiveDepartment } from '../api/directory-api.js';
import { DepartmentLeaders } from './department-leaders.js';
import { PersonRow } from './person-row.js';

/**
 * Правая панель выбранного подразделения (#84, референс — правая колонка окна
 * структуры Битрикса): руководитель и ВСЕ заместители (кликабельны — карточка
 * сотрудника в стеке, ADR-0009), сотрудники подразделения ТЕКУЩЕЙ структуры
 * (поиск по имени/должности), подчинённые руководителя по managerId — ВОЗМОЖНЫ
 * из других подразделений и это нормально (кейс «группы ГИПов», требование 1 #18).
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
  canManage,
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
  /** Право `directory.manage`: админ-действия панели (без права — просмотр). */
  canManage: boolean;
}) {
  const archive = useArchiveDepartment(kind);
  const [archiveOpen, setArchiveOpen] = useState(false);
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
              {canManage && (
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
                    {/* Непустой узел не архивируется (409 has_children): активные
                        дети archived-родителя выпали бы из дерева вида. */}
                    {shown.children.length === 0 && (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setArchiveOpen(true)}
                      >
                        {ui.employees.archiveDepartment}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
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
            <DepartmentLeaders
              headId={shown.headId}
              headName={shown.headName}
              deputies={shown.deputies}
              users={users}
            />
            <section className="flex min-h-0 flex-1 flex-col gap-2">
              {/* Счётчик — штат (#723): строки уволенных остаются в списке
                  (их карточки открываются), но в число не входят — как
                  memberCount подразделения на API. */}
              <NodeLabel label={ui.employees.panelMembers} count={activeStaffCount(members)} />
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
                  <div className="flex flex-col gap-0.5">
                    {members.map((person) => (
                      <PersonRow key={person.id} person={person} />
                    ))}
                  </div>
                ) : (
                  <span className="px-2 text-sm text-muted-foreground">
                    {ui.employees.emptyDepartment}
                  </span>
                )}
              </div>
            </section>
            {reports.length > 0 && (
              <section className="flex shrink-0 flex-col gap-1.5">
                <NodeLabel label={ui.employees.panelReports} count={activeStaffCount(reports)} />
                <div className="flex flex-col gap-0.5">
                  {reports.map((person) => (
                    <PersonRow key={person.id} person={person} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="w-full bg-card sm:max-w-sm">
          <DialogTitle className="text-base font-semibold text-foreground">
            {ui.employees.archiveDepartmentTitle}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{ui.employees.archiveDepartmentText}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiveOpen(false)}>
              {ui.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={archive.isPending}
              onClick={() => {
                if (!shown) return;
                archive.mutate(shown.id, {
                  onSuccess: () => {
                    setArchiveOpen(false);
                    onClose();
                  },
                });
              }}
            >
              {ui.employees.archiveConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
