import { useState } from 'react';
import { Archive, Check, Pencil, Plus, X } from 'lucide-react';
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
      <DialogContent
        className="w-full bg-card sm:max-w-md"
        // Esc в режиме переименования отменяет строку, а не закрывает окно
        // (Radix ловит Esc на document раньше input — гасим на контенте).
        onEscapeKeyDown={(event) => {
          if (editingId) {
            event.preventDefault();
            setEditingId(null);
          }
        }}
      >
        <DialogTitle className="text-base font-semibold text-foreground">
          {ui.employees.positions}
        </DialogTitle>
        {/* Переключатель структуры — компактной пилюлей в левом краю, как в
            шапке раздела (не растягиваем на всю ширину окна). */}
        <StructureKindSwitcher kind={kind} onChange={setKind} className="justify-self-start" />
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
          <Button disabled={!draft.trim() || pending} onClick={add}>
            <Plus data-icon="inline-start" />
            {ui.employees.positionAdd}
          </Button>
        </div>
        <ul className="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-border">
          {active.length === 0 ? (
            <li className="flex h-24 items-center justify-center px-3 text-sm text-muted-foreground">
              {ui.employees.noPositions}
            </li>
          ) : null}
          {active.map((position) => (
            <li
              key={position.id}
              className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent/30"
            >
              {editingId === position.id ? (
                <>
                  <Input
                    autoFocus
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    className="h-7 flex-1 text-sm"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveRename(position.id);
                      if (event.key === 'Escape') {
                        // Esc отменяет переименование, а не закрывает всё окно
                        // (Radix ловит Esc на document — гасим всплытие).
                        event.stopPropagation();
                        setEditingId(null);
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={ui.common.save}
                    title={ui.common.save}
                    disabled={pending}
                    onClick={() => saveRename(position.id)}
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
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
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={ui.employees.renamePosition}
                    title={ui.employees.renamePosition}
                    onClick={() => {
                      setEditingId(position.id);
                      setEditingName(position.name);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
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
