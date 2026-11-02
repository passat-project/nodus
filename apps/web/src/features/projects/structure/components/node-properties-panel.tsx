import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type {
  CustomFieldDefinition,
  CustomFieldRef,
  CustomFieldValue,
  NodeKind,
  ProjectNode,
} from '@nodus/contracts';
import { effectiveNodeForm, missingNodeFields, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { cn } from '@nodus/ui/lib/utils';

import { useFrameReady } from '../../../../shared/ui/use-frame-ready.js';
import { CommitInput } from '../../../../shared/ui/panel/commit-field.js';
import { NodeKindGlyph } from '../lib/node-kind-icon.js';
import { useUpdateNode } from '../api/structure-api.js';
import { NodeKindChangeStep } from './node-kind-change-step.js';
import { NodePanelFields } from './node-form-fields.js';

/**
 * Правая панель «Свойства папки» (#556, В5, §4c): вталкивающая колонка
 * «Структуры» (обёртка монтирована всегда, ширина 200 мс). Название, шифр,
 * вид и атрибуты формы с правкой на месте — оптимистично. Смена вида:
 * недостающие обязательные нового вида собираются встроенным шагом «Для
 * вида «Комплект» заполните: …» и уходят ОДНИМ PATCH (Р6). Неруководству —
 * только просмотр. Пока панель открыта, клик по другой папке переключает её;
 * Esc закрывает.
 */
export function NodePropertiesPanel({
  projectId,
  node,
  kinds,
  definitions,
  refs,
  canEdit,
  onClose,
}: {
  projectId: string;
  node: ProjectNode | null;
  kinds: NodeKind[];
  definitions: readonly CustomFieldDefinition[];
  refs: readonly CustomFieldRef[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const ready = useFrameReady();
  const update = useUpdateNode(projectId);
  const [pendingKindId, setPendingKindId] = useState<string | null>(null);
  // Смена выбранной папки сбрасывает незавершённый шаг смены вида.
  useEffect(() => setPendingKindId(null), [node?.id]);

  useEffect(() => {
    if (!node) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]')) return;
      event.preventDefault();
      if (pendingKindId) setPendingKindId(null);
      else onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [node, pendingKindId, onClose]);

  const kind = node ? kinds.find((entry) => entry.id === node.kindId) : undefined;
  const targetKind = pendingKindId ? kinds.find((entry) => entry.id === pendingKindId) : undefined;

  function patchValue(fieldId: string, value: CustomFieldValue | null, picked?: CustomFieldRef[]) {
    if (!node) return;
    update.mutate({
      nodeId: node.id,
      customFields: { [fieldId]: value },
      ...(picked ? { refs: picked } : {}),
    });
  }

  function chooseKind(nextId: string) {
    if (!node || nextId === node.kindId) return;
    const next = kinds.find((entry) => entry.id === nextId);
    if (!next) return;
    const form = effectiveNodeForm(next, definitions);
    const missing = missingNodeFields(form, { code: node.code, customFields: node.customFields });
    if (missing.length === 0) update.mutate({ nodeId: node.id, kindId: next.id });
    else setPendingKindId(next.id);
  }

  return (
    <div
      aria-hidden={node === null}
      inert={node === null}
      className={cn(
        'h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
        node && ready ? 'w-80' : 'w-0',
      )}
    >
      <aside className="flex h-full w-80 flex-col border-l border-border bg-card">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          {kind ? (
            <span className="flex size-6 shrink-0 items-center justify-center rounded border border-border text-muted-foreground">
              <NodeKindGlyph icon={kind.icon} className="size-3.5" />
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {node?.name ?? ui.structure.propertiesEmpty}
          </span>
          {node?.code ? (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{node.code}</span>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label={ui.common.close}
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>

        {node ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 *:min-w-0">
            <label className="flex flex-col gap-1">
              <NodeLabel label={ui.structure.nodeName} />
              <CommitInput
                value={node.name}
                required
                disabled={!canEdit}
                onCommit={(name) => update.mutate({ nodeId: node.id, name })}
                className="h-8 text-sm"
              />
            </label>

            {kind ? (
              <div className="flex flex-col gap-1">
                <NodeLabel label={ui.structure.nodeKind} />
                <Select
                  value={pendingKindId ?? node.kindId}
                  disabled={!canEdit}
                  onValueChange={chooseKind}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {kinds
                      .filter((entry) => entry.archivedAt === null || entry.id === node.kindId)
                      .map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          <NodeKindGlyph icon={entry.icon} className="size-3.5 shrink-0" />
                          {entry.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {targetKind ? (
              <NodeKindChangeStep
                kind={targetKind}
                definitions={definitions}
                node={node}
                refs={refs}
                onCancel={() => setPendingKindId(null)}
                onApply={(body) => {
                  update.mutate(
                    { nodeId: node.id, kindId: targetKind.id, ...body },
                    { onSuccess: () => setPendingKindId(null) },
                  );
                }}
              />
            ) : null}

            <section className="flex flex-col gap-1">
              <NodeLabel label={ui.structure.propertiesAttributes} />
              {kind ? (
                <NodePanelFields
                  kind={kind}
                  definitions={definitions}
                  code={node.code ?? ''}
                  disabled={!canEdit}
                  values={node.customFields}
                  refs={refs}
                  onCode={(code) => update.mutate({ nodeId: node.id, code: code.trim() || null })}
                  onChange={patchValue}
                />
              ) : null}
            </section>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
