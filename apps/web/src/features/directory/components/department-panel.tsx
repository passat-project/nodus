import { Building2, MoreHorizontal, Search } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DepartmentNode, UserListItem } from '@nodus/contracts';
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

import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { useArchiveDepartment } from '../api/directory-api.js';
import { structurePanelGroups } from '../lib/department-groups.js';
import { StructurePanelHeader } from './structure-panel-header.js';
import { StructureSidePanel } from './structure-side-panel.js';

/**
 * Правая панель отдела (#768, вердикты владельца 12–13.11.2026):
 * постоянная — не выезжает, не закрывается крестиком и повторным кликом по
 * карточке; поиск сотрудника сверху, ниже две группы — «Руководители»
 * (руководитель + зам, даже если они не члены отдела) и «Подчинённые»
 * (остальные активные члены). В главной карточке компании в «Подчинённых»
 * дополнительно видны сотрудники без управленческого отдела и с
 * архивным. Секции «Подчинённые руководителя» по managerId здесь больше нет
 * (она осталась в карточке сотрудника). Руководитель/зам не дублируются в
 * «Подчинённых»; уволенные в структуре не показываются. Действия — только
 * администратору; главная карточка компании не архивируется, архив успешен
 * только у пустого отдела (409 has_children иначе).
 */
export function DepartmentPanel({
  mainCard,
  node,
  users,
  activeDepartmentIds,
  highlightUserId,
  topShift,
  onArchived,
  onInvite,
  onEdit,
  canManage,
}: {
  /** Первый корень дерева — главная карточка компании. */
  mainCard: boolean;
  node: DepartmentNode;
  users: readonly UserListItem[];
  activeDepartmentIds: ReadonlySet<string>;
  /** Сотрудник, выбранный поиском: строку подсветить и показать в скролле. */
  highlightUserId: string | null;
  topShift: number;
  /** Отдел архивирован: панель переключается на родителя. */
  onArchived: (node: DepartmentNode) => void;
  onInvite: (departmentId: string) => void;
  onEdit: (node: DepartmentNode) => void;
  /** Право `directory.manage`: админ-действия панели (без права — просмотр). */
  canManage: boolean;
}) {
  const openCard = useOpenCard();
  const archive = useArchiveDepartment('management');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [search, setSearch] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setSearch('');
  }, [node.id]);

  const groups = useMemo(
    () => structurePanelGroups(node, users, { mainCard, activeDepartmentIds }),
    [node, users, mainCard, activeDepartmentIds],
  );
  const filtered = useMemo(
    () => structurePanelGroups(node, users, { mainCard, activeDepartmentIds, query: search }),
    [node, users, mainCard, activeDepartmentIds, search],
  );
  const totalShown = groups.heads.length + groups.subordinates.length;
  const filteredShown = filtered.heads.length + filtered.subordinates.length;

  // Выбранный поиском сотрудник — в поле зрения панели (строка не теряется
  // ниже скролла). Выделение живёт до следующего выбора.
  useLayoutEffect(() => {
    if (!highlightUserId) return;
    const row = bodyRef.current?.querySelector(
      `[data-employee-id="${highlightUserId}"]`,
    ) as HTMLElement | null;
    row?.scrollIntoView({ block: 'nearest' });
  }, [highlightUserId, filtered]);

  function personRow(person: UserListItem, role?: string) {
    const highlighted = highlightUserId === person.id;
    return (
      <button
        key={person.id}
        type="button"
        data-employee-id={person.id}
        onClick={(e) =>
          openCard({ kind: 'employee', id: person.id }, e.currentTarget.getBoundingClientRect())
        }
        className={cn(
          'flex items-center gap-2.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-accent',
          highlighted && 'bg-accent/60',
        )}
      >
        <PersonAvatar
          name={person.displayName}
          avatarUrl={person.avatarUrl}
          className="size-6 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{person.displayName}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {person.positionName ?? ''}
          </span>
        </span>
        {/* Роль в группе «Руководители»: руководитель и заместитель рядом, без
            подписи их не различить (вердикт 17.11.2026). */}
        {role ? (
          <span className="shrink-0 text-label-xs tracking-wide text-muted-foreground uppercase">
            {role}
          </span>
        ) : null}
      </button>
    );
  }

  /** Подпись роли в «Руководителях»: руководитель и заместители (#817). */
  function headRole(person: UserListItem): string | undefined {
    if (node.headId === person.id) return ui.employees.fieldHead;
    if (node.deputyIds.includes(person.id)) return ui.employees.fieldDeputy;
    return undefined;
  }

  return (
    <StructureSidePanel
      topShift={topShift}
      header={
        <StructurePanelHeader
          title={node.name}
          leading={
            mainCard ? (
              <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : undefined
          }
          actions={
            canManage ? (
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
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => onInvite(node.id)}>
                    {ui.employees.inviteToDepartment}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onEdit(node)}>
                    {ui.employees.editDepartmentAction}
                  </DropdownMenuItem>
                  {/* Главную карточку компании не архивируем (вердикт 12.11);
                      непустой узел не архивируется (409 has_children). */}
                  {!mainCard && node.children.length === 0 && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setArchiveOpen(true)}
                    >
                      {ui.employees.archiveDepartment}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : undefined
          }
        />
      }
    >
      <div className="relative shrink-0">
        <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={ui.employees.searchMembers}
          className="h-8 pl-7 text-sm"
        />
      </div>

      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {filtered.heads.length > 0 && (
          <section className="flex flex-col gap-1">
            <NodeLabel label={ui.employees.panelHeads} count={groups.heads.length} />
            <div className="flex flex-col gap-0.5">
              {filtered.heads.map((person) => personRow(person, headRole(person)))}
            </div>
          </section>
        )}
        {filtered.subordinates.length > 0 && (
          <section className="flex flex-col gap-1">
            <NodeLabel label={ui.employees.subordinates} count={groups.subordinates.length} />
            <div className="flex flex-col gap-0.5">
              {filtered.subordinates.map((person) => personRow(person))}
            </div>
          </section>
        )}
        {search.trim() && filteredShown === 0 && totalShown > 0 && (
          <span className="px-2 text-sm text-muted-foreground">{ui.filters.notFound}</span>
        )}
        {totalShown === 0 && (
          <span className="px-2 text-sm text-muted-foreground">{ui.employees.emptyDepartment}</span>
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
                archive.mutate(node.id, {
                  onSuccess: () => {
                    setArchiveOpen(false);
                    onArchived(node);
                  },
                });
              }}
            >
              {ui.employees.archiveConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StructureSidePanel>
  );
}
