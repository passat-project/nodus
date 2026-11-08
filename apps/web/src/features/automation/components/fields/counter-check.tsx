import { useState } from 'react';
import type {
  CustomFieldDefinition,
  CustomFieldRef,
  NumberHostKind,
  NumberPreviewResult,
  NumberSeriesRule,
} from '@nodus/contracts';
import { EMPTY_CUSTOM_FIELD_BINDINGS, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { ArrowRight, CircleAlert } from 'lucide-react';

import { CustomFieldEditor } from '../../../../shared/custom-fields/value-editor.js';
import { SegmentedControl } from '../../../../shared/ui/segmented-control.js';
import { useNumberPreview } from '../../api/numbering-api.js';
import { fill, type ContainerNames } from '../../lib/counter-rule.js';
import { countTitle, NextNumberEditor, useSaveNext } from './counter-counts.js';

const counter = ui.customFields.dialog.counter;

/** Тип ref-поля для выбора записи нужного вида. */
const REF_TYPE = { task: 'task', letter: 'letter', node: 'node', project: 'project' } as const;

function pickerDefinition(kind: NumberHostKind): CustomFieldDefinition {
  const now = new Date(0).toISOString();
  return {
    id: '00000000-0000-4000-8000-000000000630',
    number: 0,
    type: REF_TYPE[kind],
    name: counter.checkKind[kind],
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: EMPTY_CUSTOM_FIELD_BINDINGS,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function ResultLine({
  result,
  names,
  rule,
  definitionId,
}: {
  result: NumberPreviewResult;
  names: ContainerNames;
  rule: NumberSeriesRule;
  definitionId: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const saver = useSaveNext(definitionId ?? '');
  if (!result.ok) {
    // Имя в причине — у условия, которого не нашлось (вид папки, поле).
    const missing = rule.containers.find(
      (entry) =>
        (result.reason === 'no_folder' && entry.kind === 'folder') ||
        (result.reason === 'empty_field' && entry.kind === 'field'),
    );
    const name =
      missing?.kind === 'folder'
        ? (names.nodeKind(missing.nodeKindId) ?? '')
        : missing?.kind === 'field'
          ? (names.field(missing.fieldNumber) ?? '')
          : '';
    return (
      <p className="flex items-start gap-1.5 text-sm text-danger">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
        <span>
          <span className="font-medium">{result.hostName}</span>:{' '}
          {fill(counter.checkReasons[result.reason], { name })}
        </span>
      </p>
    );
  }
  const title = countTitle(result.containers);
  const container =
    result.containers.length === 0
      ? counter.checkCompany
      : title.path
        ? `${title.path} › ${title.name}`
        : title.name;
  const nextValue = Number(result.nextDisplay.match(/\d+(?!.*\d)/)?.[0] ?? '1');
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{result.hostName}</span>
        <ArrowRight className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
        <span>{container}</span>
        <ArrowRight className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
        <span className="text-muted-foreground">{counter.sequence.toLowerCase()}:</span>
        <span className="font-mono font-medium tabular-nums">{result.nextDisplay}</span>
      </p>
      {result.alreadyAssigned ? (
        <p className="text-xs text-muted-foreground">
          {fill(counter.checkAlready, { number: result.alreadyAssigned })}
        </p>
      ) : null}
      {result.emptySegments.length > 0 ? (
        <p className="text-xs text-warning">
          {fill(counter.checkEmptySegments, { names: result.emptySegments.join('», «') })}
        </p>
      ) : null}
      {/* «Задать следующий номер для…» записи, у счёта которой ещё нет
          выдач: продолжение нумерации с бумаги — только вперёд. */}
      {definitionId && !result.alreadyAssigned ? (
        editing ? (
          <NextNumberEditor
            nextValue={Number.isFinite(nextValue) ? nextValue : 1}
            disabled={saver.pending}
            onSave={(value) =>
              saver.save(
                result.containers.map((ref) => ref.id),
                value,
              )
            }
            onCancel={() => setEditing(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="self-start rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/40"
          >
            {counter.countsAddFolder.replace('…', '')} «{container}»
          </button>
        )
      ) : null}
    </div>
  );
}

/**
 * «Проверка на записи» (#630): администратор выбирает реальную запись и
 * видит, внутри какой папки/проекта/портфеля она считается и какой номер
 * получит. Номер не тратится — это предпросмотр по черновику правила.
 */
export function CounterCheck({
  rule,
  definitionId,
  participantTypeIds,
  kinds,
  names,
}: {
  rule: NumberSeriesRule;
  definitionId: string | null;
  participantTypeIds: readonly string[];
  /** Виды записей, которые отмечены в «Кто получает номер». */
  kinds: readonly NumberHostKind[];
  names: ContainerNames;
}) {
  const [kind, setKind] = useState<NumberHostKind>(kinds[0] ?? 'task');
  const [picked, setPicked] = useState<{ id: string; refs: CustomFieldRef[] } | null>(null);
  const preview = useNumberPreview();
  const active = kinds.includes(kind) ? kind : (kinds[0] ?? 'task');

  function check(hostId: string) {
    preview.mutate({
      ...(definitionId ? { definitionId } : {}),
      rule,
      participantTypeIds: [...participantTypeIds],
      host: { kind: active, id: hostId },
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <span className="text-label text-muted-foreground">{counter.check}</span>
      <div className="flex flex-wrap items-center gap-2">
        {kinds.length > 1 ? (
          <SegmentedControl
            value={active}
            ariaLabel={counter.check}
            activeClassName="bg-accent text-foreground"
            options={kinds.map((entry) => ({ value: entry, label: counter.checkKind[entry] }))}
            onChange={(next) => {
              setKind(next);
              setPicked(null);
              preview.reset();
            }}
          />
        ) : null}
        <div className={cn('min-w-56 flex-1')}>
          <CustomFieldEditor
            key={active}
            definition={pickerDefinition(active)}
            value={picked?.id}
            refs={picked?.refs ?? []}
            variant="form"
            onCommit={(value, refs) => {
              if (typeof value !== 'string') {
                setPicked(null);
                preview.reset();
                return;
              }
              setPicked({ id: value, refs: refs ?? [] });
              check(value);
            }}
          />
        </div>
      </div>
      {preview.data ? (
        <ResultLine result={preview.data} names={names} rule={rule} definitionId={definitionId} />
      ) : (
        <p className="text-xs text-muted-foreground">{counter.checkPick}</p>
      )}
    </section>
  );
}
