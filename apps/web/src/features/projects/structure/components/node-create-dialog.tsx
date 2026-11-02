import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { NodeKind, ProjectNode } from '@nodus/contracts';
import { NODE_LIMITS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { cn } from '@nodus/ui/lib/utils';

import { useBatchCreateNodes, useCreateNode } from '../api/structure-api.js';
import { NodeKindGlyph } from '../lib/node-kind-icon.js';

/** Селект вида узла: значок + имя (ярлык узла, вердикт владельца 30.10). */
function KindSelect({
  kinds,
  value,
  onChange,
}: {
  kinds: NodeKind[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ui.structure.nodeKind} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {kinds.map((kind) => (
          <SelectItem key={kind.id} value={kind.id}>
            <NodeKindGlyph icon={kind.icon} className="size-3.5 shrink-0" />
            {kind.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Окно создания узла («Создать узел» тулбара / «Создать узел внутри» меню):
 * название, шифр, вид узла; родитель задан входом (null — корень проекта).
 * «Пакетное создание» — не отдельная кнопка тулбара, а шеврон, который
 * раскрывает это же окно в режим «Здания: поз. 1–3» (вердикт владельца).
 */
export function NodeCreateDialog({
  projectId,
  parent,
  kinds,
  onClose,
}: {
  projectId: string;
  parent: ProjectNode | null;
  kinds: NodeKind[];
  onClose: () => void;
}) {
  const active = kinds.filter((kind) => kind.archivedAt === null);
  const create = useCreateNode(projectId);
  const batch = useBatchCreateNodes(projectId);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [kindId, setKindId] = useState(active[0]?.id ?? '');
  const [batchOpen, setBatchOpen] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('3');

  const names = useMemo(() => {
    if (!batchOpen) return [];
    const start = Number.parseInt(from, 10);
    const end = Number.parseInt(to, 10);
    if (!prefix.trim() || !Number.isFinite(start) || !Number.isFinite(end) || end < start)
      return [];
    return Array.from({ length: end - start + 1 }, (_, i) => `${prefix.trim()} ${start + i}`).slice(
      0,
      NODE_LIMITS.batch,
    );
  }, [batchOpen, prefix, from, to]);

  const canSubmit = batchOpen
    ? names.length > 0 && kindId.length > 0
    : name.trim().length > 0 && kindId.length > 0;
  const pending = create.isPending || batch.isPending;

  function submit() {
    if (!canSubmit) return;
    if (batchOpen) {
      batch.mutate({ parentId: parent?.id ?? null, kindId, names }, { onSuccess: onClose });
      return;
    }
    create.mutate(
      {
        parentId: parent?.id ?? null,
        kindId,
        name: name.trim(),
        ...(code.trim() ? { code: code.trim() } : {}),
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="max-w-md"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{ui.structure.createNode}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <NodeLabel
              label={
                parent ? `${ui.structure.nodeParent}: ${parent.name}` : ui.structure.rootParent
              }
            />
          </div>

          <button
            type="button"
            onClick={() => setBatchOpen((prev) => !prev)}
            aria-expanded={batchOpen}
            className="flex h-8 items-center gap-1.5 self-start rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronDown
              className={cn('size-3.5 transition-transform', batchOpen && 'rotate-180')}
              strokeWidth={1.75}
            />
            {ui.structure.createNodesBatch}
          </button>

          {batchOpen ? (
            <>
              <label className="flex flex-col gap-1">
                <NodeLabel label={ui.structure.batchPrefix} />
                <Input
                  autoFocus
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder={ui.structure.kindsNamePlaceholder}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <NodeLabel label={ui.structure.batchFrom} />
                  <Input
                    inputMode="numeric"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <NodeLabel label={ui.structure.batchTo} />
                  <Input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
              </div>
              {names.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <NodeLabel label={`${ui.structure.batchPreview}: ${names.length}`} />
                  <ul className="max-h-32 overflow-y-auto text-sm text-muted-foreground">
                    {names.map((n) => (
                      <li key={n} className="truncate">
                        {n}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <NodeLabel label={ui.structure.nodeName} />
                <Input
                  autoFocus
                  value={name}
                  maxLength={NODE_LIMITS.nameLength}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
              </label>
              <label className="flex flex-col gap-1">
                <NodeLabel label={ui.structure.nodeCode} />
                <Input
                  value={code}
                  maxLength={NODE_LIMITS.codeLength}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            </>
          )}

          <div className="flex flex-col gap-1">
            <NodeLabel label={ui.structure.nodeKind} />
            <KindSelect kinds={active} value={kindId} onChange={setKindId} />
            {active.length === 0 ? (
              <p className="text-xs text-muted-foreground">{ui.structure.kindsEmpty}</p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button disabled={pending || !canSubmit} onClick={submit}>
            {ui.common.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
