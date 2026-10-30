import { useState } from 'react';
import { Archive, Check, Pencil, X } from 'lucide-react';
import type { OrgUnitKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';

import {
  useArchivePosition,
  useCreatePosition,
  usePositions,
  useUpdatePosition,
} from '../api/directory-api.js';
import { StructureKindSwitcher } from './structure-kind-switcher.js';

/**
 * Управление должностями (#441, право `directory.manage`): список активных
 * должностей выбранной структуры (management/legal), создание, переименование
 * и архивация (I15: удаления нет — архивная должность остаётся читаемой).
 * Вид должности неизменяем после создания (контракт #441).
 */
export function PositionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [kind, setKind] = useState<OrgUnitKind>('management');
  const positions = usePositions(kind).data ?? [];
  const create = useCreatePosition(kind);
  const update = useUpdatePosition(kind);
  const archive = useArchivePosition(kind);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const active = positions.filter((position) => position.isActive);
  const pending = create.isPending || update.isPending || archive.isPending;

  function add() {
    const name = draft.trim();
    if (!name || pending) return;
    create.mutate({ name, kind, sortOrder: 0 }, { onSuccess: () => setDraft('') });
  }

  function saveRename(id: string) {
    const name = editingName.trim();
    if (!name || pending) return;
    update.mutate(
      { id, patch: { name } },
      {
        onSuccess: () => {
          setEditingId(null);
          setEditingName('');
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-md bg-card">
        <DialogTitle className="text-base font-semibold text-foreground">
          {ui.employees.positions}
        </DialogTitle>
        <StructureKindSwitcher kind={kind} onChange={setKind} />
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={ui.employees.positionNamePlaceholder}
            className="h-8 flex-1 text-sm"
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
          />
          <Button size="sm" disabled={!draft.trim() || pending} onClick={add}>
            {ui.employees.positionAdd}
          </Button>
        </div>
        <ul className="flex max-h-72 flex-col overflow-y-auto rounded-md border border-border">
          {active.map((position) => (
            <li key={position.id} className="flex items-center gap-2 px-2.5 py-1.5">
              {editingId === position.id ? (
                <>
                  <Input
                    autoFocus
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    className="h-7 flex-1 text-sm"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveRename(position.id);
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={ui.common.save}
                    title={ui.common.save}
                    disabled={pending}
                    onClick={() => saveRename(position.id)}
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={ui.common.cancel}
                    title={ui.common.cancel}
                    onClick={() => setEditingId(null)}
                  >
                    <X className="size-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm">{position.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={ui.employees.editDepartment}
                    title={ui.employees.editDepartment}
                    onClick={() => {
                      setEditingId(position.id);
                      setEditingName(position.name);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={ui.employees.positionArchive}
                    title={ui.employees.positionArchive}
                    disabled={pending}
                    onClick={() => archive.mutate(position.id)}
                  >
                    <Archive className="size-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
