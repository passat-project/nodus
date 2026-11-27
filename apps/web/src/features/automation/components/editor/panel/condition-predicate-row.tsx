import type {
  ConditionFieldOp,
  ConditionPredicate,
  ConditionQuery,
  CustomFieldDefinition,
  CustomFieldModule,
  CustomFieldValue,
  ProcessType,
  StageOutcome,
  TaskSystemState,
} from '@nodus/contracts';
import {
  CONDITION_FIELD_OPS_BY_TYPE,
  customFieldIdOfKey,
  customFieldKey,
  ui,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { X } from 'lucide-react';

import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { CustomFieldEditor } from '../../../../../shared/custom-fields/value-editor.js';

/** Операторы без значения: поле значения не спрашиваем. */
const NO_VALUE_OPS = new Set<ConditionFieldOp>(['filled', 'not_filled']);

/** Ключ псевдо-пункта удалённого атрибута (снять ссылку можно здесь же). */
const UNKNOWN_FIELD = '__unknown__';

type FieldPredicate = Extract<ConditionPredicate, { kind: 'field' }>;

const SYSTEM_STATES = ['backlog', 'active', 'paused', 'done', 'closed'] as const;
const OUTCOMES = ['success', 'cancelled', 'rejected'] as const;

/**
 * Строка «условие по записи» конструктора выборки (#635): тип записи,
 * значение поля (атрибут + оператор по матрице + значение по типу атрибута),
 * статус выбранного типа, группа статуса, итог, «результат выдан».
 * Статус активен только при type_is в той же выборке (грамматика публикации).
 */
export function ConditionPredicateRow({
  predicate,
  query,
  scope,
  types,
  stagesByType,
  readOnly,
  onChange,
  onRemove,
}: {
  predicate: ConditionPredicate;
  /** Выборка-хозяин: stage_is предлагается только при type_is в ней. */
  query: ConditionQuery;
  scope: CustomFieldModule;
  /** Живые типы процессов (пикер type_is). */
  types: readonly ProcessType[];
  /** Стадии по typeId — маршруты типов из type_is этой выборки. */
  stagesByType: ReadonlyMap<string, readonly { id: string; name: string }[]>;
  readOnly: boolean;
  onChange: (predicate: ConditionPredicate) => void;
  onRemove: () => void;
}) {
  const t = ui.automation.condition;
  const { data: definitions = [] } = useCustomFieldDefinitions(scope);
  const typeIsIds = query.where.flatMap((p) => (p.kind === 'type_is' ? [p.typeId] : []));

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-medium">
          {t.predicates[predicate.kind]}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={readOnly}
          aria-label={t.removeRule}
          onClick={onRemove}
        >
          <X />
        </Button>
      </div>

      {predicate.kind === 'type_is' ? (
        <Select
          value={predicate.typeId}
          disabled={readOnly}
          onValueChange={(typeId) => onChange({ kind: 'type_is', typeId })}
        >
          <SelectTrigger className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            {types.map((type) => (
              <SelectItem key={type.id} value={type.id}>
                {type.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {predicate.kind === 'stage_is' ? (
        typeIsIds.length === 0 ? (
          <p className="text-xs break-words text-muted-foreground">{t.stageNeedsType}</p>
        ) : (
          <Select
            value={predicate.stageId}
            disabled={readOnly}
            onValueChange={(stageId) => onChange({ kind: 'stage_is', stageId })}
          >
            <SelectTrigger className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="nokey">
              {typeIsIds.flatMap((typeId) =>
                (stagesByType.get(typeId) ?? []).map((stage) => (
                  <SelectItem key={`${typeId}:${stage.id}`} value={stage.id}>
                    {stage.name}
                  </SelectItem>
                )),
              )}
            </SelectContent>
          </Select>
        )
      ) : null}

      {predicate.kind === 'system_state' ? (
        <Select
          value={predicate.state}
          disabled={readOnly}
          onValueChange={(state) =>
            onChange({ kind: 'system_state', state: state as TaskSystemState })
          }
        >
          <SelectTrigger className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            {SYSTEM_STATES.map((state) => (
              <SelectItem key={state} value={state}>
                {ui.automation.bands[state]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {predicate.kind === 'outcome' ? (
        <Select
          value={predicate.outcome}
          disabled={readOnly}
          onValueChange={(outcome) =>
            onChange({ kind: 'outcome', outcome: outcome as StageOutcome })
          }
        >
          <SelectTrigger className="w-full min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            {OUTCOMES.map((outcome) => (
              <SelectItem key={outcome} value={outcome}>
                {outcome === 'success'
                  ? ui.automation.outcomeSuccess
                  : outcome === 'cancelled'
                    ? ui.automation.outcomeCancelled
                    : ui.automation.outcomeRejected}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {predicate.kind === 'result_issued' ? (
        <p className="text-xs break-words text-muted-foreground">
          {ui.automation.resultIssuedHint}
        </p>
      ) : null}

      {predicate.kind === 'field' ? (
        <FieldPredicateBody
          predicate={predicate}
          definitions={definitions}
          readOnly={readOnly}
          onChange={onChange}
        />
      ) : null}
    </div>
  );
}

/** Атрибут → оператор (по матрице типа атрибута) → значение тем же
 *  редактором, что в карточке (одна грамматика значений). */
function FieldPredicateBody({
  predicate,
  definitions,
  readOnly,
  onChange,
}: {
  predicate: FieldPredicate;
  definitions: readonly CustomFieldDefinition[];
  readOnly: boolean;
  onChange: (predicate: ConditionPredicate) => void;
}) {
  const t = ui.automation.condition;
  const known = customFieldIdOfKey(predicate.field) !== null;
  const definition = definitions.find((d) => customFieldIdOfKey(predicate.field) === d.id);
  const ops = definition ? CONDITION_FIELD_OPS_BY_TYPE[definition.type] : null;
  const opAllowed = ops === null || ops.includes(predicate.op);
  const withOp = (op: ConditionFieldOp) =>
    onChange({
      kind: 'field',
      field: predicate.field,
      op,
      ...(NO_VALUE_OPS.has(op) ? {} : { value: predicate.value ?? null }),
    });

  return (
    <>
      <Select
        value={known && definition ? predicate.field : UNKNOWN_FIELD}
        disabled={readOnly}
        onValueChange={(field) => {
          const next = definitions.find((d) => customFieldKey(d.id) === field);
          const op = CONDITION_FIELD_OPS_BY_TYPE[next?.type ?? 'text'][0] ?? 'eq';
          onChange({ kind: 'field', field: field as FieldPredicate['field'], op });
        }}
      >
        <SelectTrigger className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="nokey">
          {!definition ? (
            <SelectItem value={UNKNOWN_FIELD} disabled>
              {ui.automation.creation.unknownAttribute}
            </SelectItem>
          ) : null}
          {definitions.map((d) => (
            <SelectItem key={d.id} value={customFieldKey(d.id)}>
              {d.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={predicate.op}
        disabled={readOnly}
        onValueChange={(op) => withOp(op as ConditionFieldOp)}
      >
        <SelectTrigger className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="nokey">
          {(ops ?? (Object.keys(t.predicateOps) as ConditionFieldOp[])).map((op) => (
            <SelectItem key={op} value={op}>
              {t.predicateOps[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!opAllowed ? (
        <p className="text-xs break-words text-danger">
          {ui.automation.problems.condition_field_op_incompatible}
        </p>
      ) : null}

      {definition && !NO_VALUE_OPS.has(predicate.op) ? (
        <CustomFieldEditor
          definition={definition}
          value={predicate.value ?? undefined}
          refs={[]}
          disabled={readOnly}
          variant="form"
          onCommit={(value: CustomFieldValue | null) =>
            onChange({
              kind: 'field',
              field: predicate.field,
              op: predicate.op,
              value: value ?? null,
            })
          }
        />
      ) : null}
    </>
  );
}
