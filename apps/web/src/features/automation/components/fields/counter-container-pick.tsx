import type { NumberContainer, NumberContainerKind, NumberHostKind } from '@nodus/contracts';
import { NUMBER_CONTAINERS_MAX, numberContainerReachable, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Plus, X } from 'lucide-react';

import { containerKey, containerPath, type ContainerNames } from '../../lib/counter-rule.js';
import { CounterSearchPick } from './counter-search-pick.js';

const counter = ui.customFields.dialog.counter;

/** Порядок вариантов «Вести счёт отдельно для»: от общего к частному. */
const KINDS: readonly NumberContainerKind[] = [
  'record_type',
  'project_type',
  'portfolio',
  'project',
  'parent_folder',
  'folder',
  'parent_task',
  'field',
];

/** Значение «не делить» в селекте первого условия. */
const NONE = 'company';

/** Вариант подходит, только если ВСЕ отмеченные типы могут лежать внутри
 *  такого условия (письма — не в папках, проект — не в проекте). */
export function containerKindsFor(hostKinds: readonly NumberHostKind[]): NumberContainerKind[] {
  const probe = (kind: NumberContainerKind): NumberContainer =>
    kind === 'folder'
      ? { kind, nodeKindId: '00000000-0000-4000-8000-000000000000' }
      : kind === 'field'
        ? { kind, fieldNumber: 1 }
        : ({ kind } as NumberContainer);
  return KINDS.filter((kind) =>
    hostKinds.every((host) => numberContainerReachable(probe(kind), host)),
  );
}

const kindLabel = (kind: NumberContainerKind | typeof NONE) =>
  kind === NONE
    ? counter.containers.company
    : kind === 'folder'
      ? counter.containers.folderGroup
      : kind === 'field'
        ? counter.containers.fieldGroup
        : counter.containers[kind];

/**
 * «Вести счёт отдельно для» (#630, модель v3): список условий (до трёх,
 * как разрезы 1С/Directum — «в каждом здании для каждой марки»), каждое —
 * короткий селект, отфильтрованный по типам из «Кто получает номер»; вид
 * папки и поле — вторым шагом с поиском. Пусто — сквозная нумерация. Пока
 * никто не отмечен — неактивно с подсказкой.
 */
export function CounterContainerPick({
  containers,
  hostKinds,
  nodeKinds,
  fields,
  names,
  disabled,
  onChange,
}: {
  containers: readonly NumberContainer[];
  hostKinds: readonly NumberHostKind[];
  nodeKinds: readonly { id: string; name: string }[];
  /** Поля-ссылки и списки, стоящие у ВСЕХ отмеченных типов (номер атрибута как id). */
  fields: readonly { number: number; name: string }[];
  names: ContainerNames;
  disabled: boolean;
  onChange: (containers: NumberContainer[]) => void;
}) {
  const empty = hostKinds.length === 0;
  const available = containerKindsFor(hostKinds).filter(
    (kind) =>
      (kind !== 'folder' || nodeKinds.length > 0) && (kind !== 'field' || fields.length > 0),
  );
  const used = new Set(containers.map(containerKey));

  /** Первое ещё не занятое значение вида (папка/поле — первый свободный). */
  function fresh(kind: NumberContainerKind): NumberContainer | null {
    if (kind === 'folder') {
      const kindId = nodeKinds.find((entry) => !used.has(`folder:${entry.id}`))?.id;
      return kindId ? { kind, nodeKindId: kindId } : null;
    }
    if (kind === 'field') {
      const number = fields.find((entry) => !used.has(`field:${entry.number}`))?.number;
      return number !== undefined ? { kind, fieldNumber: number } : null;
    }
    return used.has(kind) ? null : ({ kind } as NumberContainer);
  }

  const kindsFor = (current: NumberContainer | null) =>
    available.filter((kind) => kind === current?.kind || fresh(kind) !== null);

  function replace(index: number, next: NumberContainer | null) {
    const out = [...containers];
    if (next) out[index] = next;
    else out.splice(index, 1);
    onChange(out);
  }

  const addable = containers.length < NUMBER_CONTAINERS_MAX ? kindsFor(null) : [];

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label text-muted-foreground">{counter.container}</span>
      {containers.length === 0 ? (
        <Select
          value={NONE}
          disabled={disabled || empty}
          onValueChange={(kind) => {
            const next = kind === NONE ? null : fresh(kind as NumberContainerKind);
            if (next) onChange([next]);
          }}
        >
          <SelectTrigger className="h-8 w-full" aria-label={counter.container}>
            <SelectValue>{kindLabel(NONE)}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            <SelectItem value={NONE}>{kindLabel(NONE)}</SelectItem>
            {available.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {kindLabel(kind)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        containers.map((container, index) => (
          <div key={containerKey(container)} className="flex flex-col gap-1.5">
            {index > 0 ? (
              <span className="text-xs text-muted-foreground">{counter.containerAnd}</span>
            ) : null}
            <div className="flex items-center gap-1.5">
              <Select
                value={container.kind}
                disabled={disabled}
                onValueChange={(kind) => {
                  if (kind !== container.kind) replace(index, fresh(kind as NumberContainerKind));
                }}
              >
                <SelectTrigger className="h-8 min-w-0 flex-1" aria-label={counter.container}>
                  <SelectValue>{kindLabel(container.kind)}</SelectValue>
                </SelectTrigger>
                <SelectContent position="popper" className="nokey">
                  {kindsFor(container).map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {kindLabel(kind)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground"
                disabled={disabled}
                aria-label={counter.containerRemove}
                title={counter.containerRemove}
                onClick={() => replace(index, null)}
              >
                <X className="size-4" strokeWidth={1.75} />
              </Button>
            </div>
            {container.kind === 'folder' ? (
              <CounterSearchPick
                label={counter.folderKindPick}
                search={counter.folderKindSearch}
                empty={counter.pickEmpty}
                value={container.nodeKindId}
                options={nodeKinds.filter(
                  (kind) => kind.id === container.nodeKindId || !used.has(`folder:${kind.id}`),
                )}
                disabled={disabled}
                onChange={(nodeKindId) => replace(index, { kind: 'folder', nodeKindId })}
              />
            ) : null}
            {container.kind === 'field' ? (
              <CounterSearchPick
                label={counter.fieldPick}
                search={counter.fieldSearch}
                empty={counter.pickEmpty}
                value={String(container.fieldNumber)}
                options={fields
                  .filter(
                    (field) =>
                      field.number === container.fieldNumber || !used.has(`field:${field.number}`),
                  )
                  .map((field) => ({ id: String(field.number), name: field.name }))}
                disabled={disabled}
                onChange={(id) => replace(index, { kind: 'field', fieldNumber: Number(id) })}
              />
            ) : null}
            <span className="text-xs text-muted-foreground">{containerPath(container, names)}</span>
          </div>
        ))
      )}
      {containers.length > 0 && addable.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 self-start px-2 text-xs"
          disabled={disabled}
          title={counter.containerAddHint}
          onClick={() => {
            const next = fresh(addable[0]!);
            if (next) onChange([...containers, next]);
          }}
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
          {counter.containerAdd}
        </Button>
      ) : null}
      {containers.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          {empty ? counter.containerNeedsRecipients : counter.containerPath.company}
        </span>
      ) : null}
    </div>
  );
}
