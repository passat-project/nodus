import type { NumberContainer, NumberContainerKind, NumberHostKind } from '@nodus/contracts';
import { numberContainerReachable, ui } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { containerPath, type ContainerNames } from '../../lib/counter-rule.js';
import { CounterSearchPick } from './counter-search-pick.js';

const counter = ui.customFields.dialog.counter;

/** Порядок вариантов «Вести счёт отдельно для»: от общего к частному. */
const KINDS: readonly NumberContainerKind[] = [
  'company',
  'project_type',
  'portfolio',
  'project',
  'folder',
  'parent_task',
  'field',
];

/** Вариант подходит, только если ВСЕ отмеченные типы могут лежать в таком
 *  контейнере (письма — не в папках, проект — не в проекте). */
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

const kindLabel = (kind: NumberContainerKind) =>
  kind === 'folder'
    ? counter.containers.folderGroup
    : kind === 'field'
      ? counter.containers.fieldGroup
      : counter.containers[kind];

/**
 * «Вести счёт отдельно для» (#630): короткий список, отфильтрованный по
 * типам из «Кто получает номер»; вид папки и поле — вторым шагом с поиском.
 * Пока никто не отмечен — неактивно с подсказкой.
 */
export function CounterContainerPick({
  container,
  hostKinds,
  nodeKinds,
  fields,
  names,
  disabled,
  onChange,
}: {
  container: NumberContainer;
  hostKinds: readonly NumberHostKind[];
  nodeKinds: readonly { id: string; name: string }[];
  /** Поля-ссылки и списки, стоящие у ВСЕХ отмеченных типов (номер атрибута как id). */
  fields: readonly { number: number; name: string }[];
  names: ContainerNames;
  disabled: boolean;
  onChange: (container: NumberContainer) => void;
}) {
  const empty = hostKinds.length === 0;
  const kinds = containerKindsFor(hostKinds).filter(
    (kind) =>
      (kind !== 'folder' || nodeKinds.length > 0) && (kind !== 'field' || fields.length > 0),
  );

  function pickKind(kind: NumberContainerKind) {
    if (kind === 'folder') {
      const first = nodeKinds[0];
      if (first) onChange({ kind, nodeKindId: first.id });
    } else if (kind === 'field') {
      const first = fields[0];
      if (first) onChange({ kind, fieldNumber: first.number });
    } else {
      onChange({ kind } as NumberContainer);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label text-muted-foreground">{counter.container}</span>
      <Select
        value={container.kind}
        disabled={disabled || empty}
        onValueChange={(kind) => pickKind(kind as NumberContainerKind)}
      >
        <SelectTrigger className="h-8 w-full" aria-label={counter.container}>
          <SelectValue>{kindLabel(container.kind)}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" className="nokey">
          {kinds.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {kindLabel(kind)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {container.kind === 'folder' ? (
        <CounterSearchPick
          label={counter.folderKindPick}
          search={counter.folderKindSearch}
          empty={counter.pickEmpty}
          value={container.nodeKindId}
          options={nodeKinds}
          disabled={disabled}
          onChange={(nodeKindId) => onChange({ kind: 'folder', nodeKindId })}
        />
      ) : null}
      {container.kind === 'field' ? (
        <CounterSearchPick
          label={counter.fieldPick}
          search={counter.fieldSearch}
          empty={counter.pickEmpty}
          value={String(container.fieldNumber)}
          options={fields.map((field) => ({ id: String(field.number), name: field.name }))}
          disabled={disabled}
          onChange={(id) => onChange({ kind: 'field', fieldNumber: Number(id) })}
        />
      ) : null}
      <span className="text-xs text-muted-foreground">
        {empty ? counter.containerNeedsRecipients : containerPath(container, names)}
      </span>
    </div>
  );
}
