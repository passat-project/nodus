import { useMemo, useState } from 'react';
import type { NodeKindBase, NodeKindIcon, ProjectColor } from '@nodus/contracts';
import { projectColorSchema, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { cn } from '@nodus/ui/lib/utils';

import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useCreateNodeKind } from '../api/node-kinds-api.js';
import { NODE_KIND_ICON_KEYS, NodeKindGlyph } from '../../../../shared/ui/node-kind-icon.js';

/**
 * Окно создания типа папки (#857) — грамматика создания типа: название,
 * значок закрытым набором, цвет-идентичность, основа «копия живого типа
 * или с нуля» (копия берёт форму и возможности основы). Мимо-клик окно не
 * закрывает (правило 30.09: вводимое жалко).
 */
export function NodeKindCreateDialog({
  onClose,
  onCreated,
  defaultBaseKindId,
}: {
  onClose: () => void;
  /** Созданный тип открывается экраном типа папки. */
  onCreated: (id: string) => void;
  /** Основа по умолчанию («Копировать тип» из меню строки). */
  defaultBaseKindId?: string;
}) {
  const create = useCreateNodeKind();
  const { data: kinds } = useNodeKinds();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<NodeKindIcon>('folder');
  const [color, setColor] = useState<ProjectColor>('blue');
  const [base, setBase] = useState<NodeKindBase>(
    defaultBaseKindId ? { kind: 'copy', kindId: defaultBaseKindId } : { kind: 'simple' },
  );

  const baseKinds = useMemo(
    () => (kinds ?? []).filter((kind) => kind.archivedAt === null),
    [kinds],
  );
  const trimmed = name.trim();
  const key = (value: string) => value.trim().toLowerCase();
  const taken = baseKinds.some((kind) => key(kind.name) === key(trimmed));

  const submit = () => {
    if (!trimmed || taken || create.isPending) return;
    create.mutate(
      { name: trimmed, icon, color, base: base.kind === 'copy' ? base : { kind: 'simple' } },
      {
        onSuccess: (kind) => {
          onCreated(kind.id);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{ui.nodeKinds.createTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">{ui.nodeKinds.panel.name}</span>
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={ui.nodeKinds.createPlaceholder}
              aria-invalid={taken || undefined}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
            />
            {taken ? <span className="text-xs text-danger">{ui.nodeKinds.nameTaken}</span> : null}
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">{ui.nodeKinds.panel.icon}</span>
            <div className="grid grid-cols-8 gap-1.5">
              {NODE_KIND_ICON_KEYS.map((key_) => (
                <button
                  key={key_}
                  type="button"
                  aria-pressed={icon === key_}
                  aria-label={ui.structure.iconNames[key_]}
                  title={ui.structure.iconNames[key_]}
                  onClick={() => setIcon(key_)}
                  className={cn(
                    'flex aspect-square min-w-0 items-center justify-center rounded-lg border transition-colors',
                    icon === key_
                      ? 'border-ring bg-accent text-foreground'
                      : 'border-border text-muted-foreground hover:border-input',
                  )}
                >
                  <NodeKindGlyph icon={key_} className="size-4" />
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">{ui.nodeKinds.panel.color}</span>
            <div className="flex gap-2">
              {projectColorSchema.options.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  aria-pressed={color === tone}
                  aria-label={ui.structure.colorNames[tone]}
                  title={ui.structure.colorNames[tone]}
                  onClick={() => setColor(tone)}
                  className={cn(
                    'size-6 rounded-full border-2 transition-colors',
                    identityTone[tone].dot,
                    color === tone ? 'border-foreground' : 'border-transparent',
                  )}
                />
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">{ui.nodeKinds.fieldBase}</span>
            <Select
              value={base.kind === 'copy' ? base.kindId : 'simple'}
              onValueChange={(value) =>
                setBase(value === 'simple' ? { kind: 'simple' } : { kind: 'copy', kindId: value })
              }
            >
              <SelectTrigger className="w-full min-w-0" aria-label={ui.nodeKinds.fieldBase}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="simple">{ui.nodeKinds.baseSimple}</SelectItem>
                {baseKinds.map((kind) => (
                  <SelectItem key={kind.id} value={kind.id}>
                    {ui.nodeKinds.baseCopy}: {kind.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button disabled={!trimmed || taken || create.isPending} onClick={submit}>
            {ui.common.create}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
