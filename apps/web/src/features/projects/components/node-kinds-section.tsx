import { useState } from 'react';
import { Archive, Check, Pencil, Plus, X } from 'lucide-react';
import type { NodeKind, NodeKindIcon, ProjectColor } from '@nodus/contracts';
import { projectColorSchema, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { NodeLabel } from '@nodus/ui/components/node-label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';

import { identityTone } from '../../../shared/ui/identity-tone.js';
import {
  useArchiveNodeKind,
  useCreateNodeKind,
  useNodeKinds,
  useUpdateNodeKind,
} from '../structure/api/node-kinds-api.js';
import { NODE_KIND_ICON_KEYS, NodeKindGlyph } from '../structure/lib/node-kind-icon.js';

/** Селект значка вида уровня: глиф + ключ enum (I15: ключи закрыты контрактом). */
function IconSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: NodeKindIcon;
  onChange: (icon: NodeKindIcon) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as NodeKindIcon)}
      disabled={disabled}
    >
      <SelectTrigger className="h-7 w-36 shrink-0 text-xs" aria-label={label} title={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-64">
        {NODE_KIND_ICON_KEYS.map((key) => (
          <SelectItem key={key} value={key}>
            <NodeKindGlyph icon={key} className="size-3.5 shrink-0" />
            {ui.structure.iconNames[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Селект цвета вида уровня: свотч + название (ru-structure.colorNames). */
function ColorSelect({
  value,
  onChange,
  disabled,
}: {
  value: ProjectColor;
  onChange: (color: ProjectColor) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as ProjectColor)}
      disabled={disabled}
    >
      <SelectTrigger className="h-7 w-32 shrink-0 text-xs" aria-label={ui.structure.fieldColor}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {projectColorSchema.options.map((color) => (
          <SelectItem key={color} value={color}>
            <span
              aria-hidden
              className={cn('size-3 shrink-0 rounded-full', identityTone[color].dot)}
            />
            {ui.structure.colorNames[color]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * «Структура → Виды узлов» (#467): справочник ярлыков узлов (значок + цвет).
 * Живёт в карточке проекта, не в «Автоматизации» (вердикт владельца). Архив —
 * не удаление: узлы архивного вида живут, новые создавать нельзя.
 */
export function NodeKindsSection({
  canManage,
  embedded = false,
}: {
  canManage: boolean;
  /** Внутри окна «Виды узлов»: без собственной карточки-панели (иначе
   *  двойная рамка и «Закрыть» снаружи внутренней панели). */
  embedded?: boolean;
}) {
  const { data, isLoading } = useNodeKinds();
  const create = useCreateNodeKind();
  const update = useUpdateNodeKind();
  const archive = useArchiveNodeKind();

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    icon: 'folder' as NodeKindIcon,
    color: 'blue' as ProjectColor,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const kinds: NodeKind[] = data ?? [];

  function submitCreate() {
    const name = draft.name.trim();
    if (!name) return;
    create.mutate(
      { name, icon: draft.icon, color: draft.color },
      {
        onSuccess: () => {
          setDraft({ name: '', icon: 'folder', color: 'blue' });
          setCreating(false);
        },
      },
    );
  }

  function submitRename(kind: NodeKind) {
    const name = editName.trim();
    setEditingId(null);
    if (name && name !== kind.name) update.mutate({ id: kind.id, name });
  }

  return (
    <section className={cn('flex flex-col gap-2', embedded ? 'p-0' : 'node-panel p-4')}>
      <div className="flex items-center gap-2">
        <NodeLabel label={ui.structure.kindsTitle} count={kinds.length} />
        {canManage ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            onClick={() => setCreating((prev) => !prev)}
          >
            <Plus className="size-3" strokeWidth={1.75} />
            {ui.structure.kindsCreate}
          </Button>
        ) : null}
      </div>

      {creating ? (
        <div className="flex h-9 items-center gap-2 px-1.5">
          <span
            aria-hidden
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded border',
              identityTone[draft.color].tile,
            )}
          >
            <NodeKindGlyph icon={draft.icon} className="size-3.5" />
          </span>
          <Input
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
            placeholder={ui.structure.kindsNamePlaceholder}
            aria-label={ui.structure.kindsCreate}
            className="h-7 min-w-0 flex-1 text-sm"
          />
          <IconSelect
            value={draft.icon}
            onChange={(icon) => setDraft((prev) => ({ ...prev, icon }))}
            label={ui.structure.fieldIcon}
          />
          <ColorSelect
            value={draft.color}
            onChange={(color) => setDraft((prev) => ({ ...prev, color }))}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={ui.common.create}
            onClick={submitCreate}
            disabled={!draft.name.trim()}
          >
            <Check className="size-3.5" strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={ui.common.cancel}
            onClick={() => {
              setCreating(false);
              setDraft({ name: '', icon: 'folder', color: 'blue' });
            }}
          >
            <X className="size-3.5" strokeWidth={2} />
          </Button>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : kinds.length === 0 ? (
        <p className="px-1 py-3 text-xs text-muted-foreground">{ui.structure.kindsEmpty}</p>
      ) : (
        <ul className="flex flex-col">
          {kinds.map((kind) => (
            <li
              key={kind.id}
              className="group flex h-9 items-center gap-2 rounded-md px-1.5 transition-colors hover:bg-accent/40"
            >
              {editingId === kind.id ? (
                <>
                  <Input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename(kind);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    aria-label={kind.name}
                    className="h-7 min-w-0 flex-1 text-sm"
                  />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={ui.common.save}
                    onClick={() => submitRename(kind)}
                  >
                    <Check className="size-3.5" strokeWidth={2} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={ui.common.cancel}
                    onClick={() => setEditingId(null)}
                  >
                    <X className="size-3.5" strokeWidth={2} />
                  </Button>
                </>
              ) : (
                <>
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded border',
                      identityTone[kind.color].tile,
                    )}
                  >
                    <NodeKindGlyph icon={kind.icon} className="size-3.5" />
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm',
                      kind.archivedAt !== null && 'text-muted-foreground line-through',
                    )}
                  >
                    {kind.name}
                  </span>
                  {kind.archivedAt !== null ? (
                    <NodeChip tone="muted">{ui.projects.status.archived}</NodeChip>
                  ) : null}
                  {canManage && kind.archivedAt === null ? (
                    <>
                      <IconSelect
                        value={kind.icon}
                        onChange={(icon) => update.mutate({ id: kind.id, icon })}
                        label={`${ui.structure.fieldIcon}: ${kind.name}`}
                      />
                      <ColorSelect
                        value={kind.color}
                        onChange={(color) => update.mutate({ id: kind.id, color })}
                      />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={ui.projects.editProject}
                        title={ui.structure.rename}
                        className="text-muted-foreground opacity-0 group-hover:opacity-100"
                        onClick={() => {
                          setEditingId(kind.id);
                          setEditName(kind.name);
                        }}
                      >
                        <Pencil className="size-3.5" strokeWidth={1.75} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={ui.structure.kindsArchive}
                        title={ui.structure.kindsArchive}
                        className="text-muted-foreground opacity-0 group-hover:opacity-100"
                        onClick={() => archive.mutate(kind.id)}
                      >
                        <Archive className="size-3.5" strokeWidth={1.75} />
                      </Button>
                    </>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
