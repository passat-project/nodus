import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { ChevronDown, Folder } from 'lucide-react';
import type {
  CustomFieldRef,
  CustomFieldValue,
  CustomFieldValues,
  NodeKind,
} from '@nodus/contracts';
import {
  effectiveNodeForm,
  ErrorCode,
  missingNodeFields,
  NODE_LIMITS,
  SYSTEM_FIELD_IDS,
  ui,
  formSlots,
} from '@nodus/contracts';
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
import { cn } from '@nodus/ui/lib/utils';

import { ApiError } from '../../../../shared/api-client.js';
import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { useBatchCreateNodes, useCreateNode } from '../api/structure-api.js';
import { useRefreshNodeKinds } from '../../node-kinds/api/node-kinds-api.js';
import { NodeBatchFields } from './node-batch-fields.js';
import { NodeCreateFields } from './node-form-fields.js';
import { NodeKindSelect } from './node-create-kind-select.js';

/**
 * Окно «Создать папку» (#556, §4c; ревизия #631): вид первым → название →
 * атрибуты формы слотами «по желанию / обязательно» — код папки идёт
 * обычным атрибутом «Код». «Создать» неактивна, пока не заполнены
 * обязательные; сервер проверяет то же (422 подсвечивает поля). Пачка —
 * шеврон этого же окна, недоступна у вида с обязательным «Кодом»: у каждой
 * папки свой код (В1). Состояние «скрыто» не спрашивается.
 */
export function NodeCreateDialog({
  projectId,
  parent,
  kinds,
  canSetup,
  onClose,
}: {
  projectId: string;
  parent: { id: string; name: string } | null;
  kinds: NodeKind[];
  canSetup: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const active = kinds.filter((kind) => kind.archivedAt === null);
  const definitions = useCustomFieldDefinitions('node');
  const create = useCreateNode(projectId);
  const batch = useBatchCreateNodes(projectId);
  const refreshKinds = useRefreshNodeKinds();

  const [kindId, setKindId] = useState(active[0]?.id ?? '');
  const [name, setName] = useState('');
  const [values, setValues] = useState<CustomFieldValues>({});
  const [refs, setRefs] = useState<CustomFieldRef[]>([]);
  const [errors, setErrors] = useState<ReadonlySet<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('3');

  const kind = active.find((entry) => entry.id === kindId) ?? active[0] ?? null;
  const form = useMemo(
    () => (kind ? effectiveNodeForm(kind, definitions.data ?? []) : null),
    [kind, definitions.data],
  );
  const codeRequired = (form ? formSlots(form) : []).some(
    (slot) => slot.fieldId === SYSTEM_FIELD_IDS.nodeCode && slot.state === 'required',
  );
  const missing = form ? missingNodeFields(form, { customFields: values }) : [];
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

  const canSubmit = kind
    ? batchOpen
      ? names.length > 0 && missing.length === 0
      : name.trim().length > 0 && missing.length === 0
    : false;
  const pending = create.isPending || batch.isPending;

  function onChange(fieldId: string, value: CustomFieldValue | null, picked?: CustomFieldRef[]) {
    setValues((prev) => {
      const next = { ...prev };
      if (value === null) delete next[fieldId];
      else next[fieldId] = value;
      return next;
    });
    if (picked?.length) {
      setRefs((prev) => {
        const map = new Map(prev.map((ref) => [`${ref.kind}:${ref.id}`, ref]));
        for (const ref of picked) map.set(`${ref.kind}:${ref.id}`, ref);
        return [...map.values()];
      });
    }
    setErrors((prev) => {
      if (!prev.has(fieldId)) return prev;
      const next = new Set(prev);
      next.delete(fieldId);
      return next;
    });
  }

  function onRuleError(error: unknown) {
    if (!(error instanceof ApiError)) return;
    if (error.code === ErrorCode.PROJECT_NODE_FIELDS_REQUIRED) {
      const fields = (error.details?.fields as string[] | undefined) ?? [];
      setErrors(new Set(fields.map((key) => key.slice('cf.'.length))));
      refreshKinds();
    }
  }

  function submit() {
    if (!canSubmit || !kind) return;
    if (batchOpen) {
      batch.mutate(
        {
          parentId: parent?.id ?? null,
          kindId: kind.id,
          names,
          ...(Object.keys(values).length > 0 ? { customFields: values } : {}),
        },
        { onSuccess: onClose, onError: onRuleError },
      );
      return;
    }
    create.mutate(
      {
        parentId: parent?.id ?? null,
        kindId: kind.id,
        name: name.trim(),
        ...(Object.keys(values).length > 0 ? { customFields: values } : {}),
      },
      { onSuccess: onClose, onError: onRuleError },
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
        <div className="flex min-w-0 flex-col gap-3">
          {/* Куда создаём — строка контекста, а не метка без значения:
              «КОРЕНЬ ПРОЕКТА» капсом висело над полями как осиротевший
              заголовок (замечание вкуса). */}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Folder className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {parent ? `${ui.structure.nodeParent}: ${parent.name}` : ui.structure.rootParent}
          </p>

          <div className="flex flex-col gap-1">
            <NodeLabel label={ui.structure.nodeKind} />
            <NodeKindSelect
              kinds={active}
              value={kind?.id ?? ''}
              canSetup={canSetup}
              onChange={(id) => {
                // Смена вида: значения прошлого вида не должны улетать в
                // customFields — сервер ответит not_in_type за слот, которого
                // в новом виде нет и который пользователь не видит (#646).
                const nextKind = active.find((entry) => entry.id === id);
                if (nextKind && definitions.data) {
                  const allowed = new Set(
                    formSlots(effectiveNodeForm(nextKind, definitions.data)).map(
                      (slot) => slot.fieldId,
                    ),
                  );
                  setValues((prev) =>
                    Object.fromEntries(
                      Object.entries(prev).filter(([fieldId]) => allowed.has(fieldId)),
                    ),
                  );
                }
                setKindId(id);
                setErrors(new Set());
              }}
              onSetup={() => {
                onClose();
                void navigate({
                  to: '/automation',
                  search: { tab: 'project-schemas', type: undefined, kind: kind?.id },
                });
              }}
            />
            {active.length === 0 ? (
              <p className="text-xs text-muted-foreground">{ui.structure.kindsEmpty}</p>
            ) : null}
          </div>

          {batchOpen ? (
            <NodeBatchFields
              prefix={prefix}
              from={from}
              to={to}
              names={names}
              onPrefix={setPrefix}
              onFrom={setFrom}
              onTo={setTo}
            />
          ) : (
            <label className="flex min-w-0 flex-col gap-1">
              <NodeLabel label={ui.structure.nodeName} />
              <Input
                autoFocus
                value={name}
                maxLength={NODE_LIMITS.nameLength}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </label>
          )}

          {kind && form ? (
            <NodeCreateFields
              kind={kind}
              definitions={definitions.data ?? []}
              values={values}
              refs={refs}
              errors={errors}
              onChange={onChange}
            />
          ) : null}

          {/* Пакетное создание — режим окна, а не поле: стоит ПОСЛЕ полей
              (владелец: вид → название → атрибуты → пачка), не разрывая
              связку «вид → название». */}
          <button
            type="button"
            onClick={() => setBatchOpen((prev) => !prev)}
            aria-expanded={batchOpen}
            disabled={codeRequired}
            title={codeRequired ? ui.structure.batchBlocked : undefined}
            className="-ml-2 flex h-8 items-center gap-1.5 self-start rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <ChevronDown
              className={cn('size-3.5 transition-transform', batchOpen && 'rotate-180')}
              strokeWidth={1.75}
            />
            {ui.structure.createNodesBatch}
          </button>
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
