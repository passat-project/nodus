import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import type {
  ConditionPredicate,
  ConditionQuery,
  ConditionSubject,
  ConditionSubjectKind,
  CustomFieldModule,
  ProcessCategory,
} from '@nodus/contracts';
import {
  CONDITION_LIMITS,
  CONDITION_SUBJECTS_BY_CATEGORY,
  bindingsOf,
  customFieldKey,
  ui,
} from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { useNodeKinds } from '../../../../../shared/api/node-kinds.js';
import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { workflowDetailOptions } from '../../../../../shared/workflow/workflow-api.js';
import { useProcessTypes } from '../../../api/automation-api.js';
import {
  addPredicate,
  removePredicateAt,
  setQuantifier,
  withPredicateAt,
  withSubject,
} from '../../../model/condition-rules.js';
import { ConditionPredicateRow } from './condition-predicate-row.js';
import { SubjectParams } from './condition-subject-params.js';

/** Атрибуты-ссылки (записи по ссылке из поля): типы, чьё значение — запись. */
const REF_FIELD_TYPES = new Set(['task', 'letter', 'node', 'project']);
const PREDICATE_KINDS = [
  'type_is',
  'field',
  'stage_is',
  'system_state',
  'outcome',
  'result_issued',
] as const;

/**
 * Конструктор общей выборки (#635, unified-model §7): «какие записи →
 * условие → сколько». Один и тот же редактор у условий (прячут кнопку) и
 * проверок (не пускают): различие — только подпись и обход у проверки.
 * Субъекты — по категории маршрута (у письма нет подзадач и папок задачи:
 * `CONDITION_SUBJECTS_BY_CATEGORY`, у письма задачные субъекты не предложены).
 */
export function ConditionQueryEditor({
  query,
  category,
  scope,
  typeId,
  readOnly,
  onChange,
}: {
  query: ConditionQuery;
  category: ProcessCategory;
  scope: CustomFieldModule;
  /** Тип маршрута: поле-ссылка выбирается из привязанных к нему атрибутов. */
  typeId?: string;
  readOnly: boolean;
  onChange: (query: ConditionQuery) => void;
}) {
  const t = ui.automation.condition;
  // Оба списка по умолчанию — только живые (архив фильтрует сервер).
  const typesQuery = useProcessTypes();
  const nodeKindsQuery = useNodeKinds();
  const { data: definitions = [] } = useCustomFieldDefinitions(scope);
  const types = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);
  const nodeKinds = useMemo(
    () => (nodeKindsQuery.data ?? []).filter((kind) => kind.archivedAt === null),
    [nodeKindsQuery.data],
  );

  // Стадии для stage_is: активные маршруты типов из type_is ЭТОЙ выборки —
  // статус выбирают по типу (публикация: stage_is требует type_is рядом).
  const typeIsIds = query.where.flatMap((p) => (p.kind === 'type_is' ? [p.typeId] : []));
  const typeById = useMemo(() => new Map(types.map((type) => [type.id, type])), [types]);
  const stageWorkflows = useQueries({
    queries: typeIsIds.map((typeId) =>
      workflowDetailOptions(typeById.get(typeId)?.workflowId ?? ''),
    ),
  });
  const stagesByType = new Map<string, { id: string; name: string }[]>();
  typeIsIds.forEach((typeId, index) => {
    const detail = stageWorkflows[index]?.data;
    if (detail) {
      stagesByType.set(
        typeId,
        detail.document.stages.map((stage) => ({ id: stage.id, name: stage.name })),
      );
    }
  });

  const subjects = CONDITION_SUBJECTS_BY_CATEGORY[category];
  const refFields = definitions.filter(
    (definition) =>
      REF_FIELD_TYPES.has(definition.type) &&
      (!typeId || bindingsOf(definition).processTypeIds.includes(typeId)),
  );
  const atPredicatesLimit = query.where.length >= CONDITION_LIMITS.predicates;
  const hasTypeIs = typeIsIds.length > 0;

  const changeSubject = (kind: ConditionSubjectKind) => {
    if (kind === query.subject.kind) return;
    let subject: ConditionSubject;
    switch (kind) {
      case 'relations':
        subject = { kind, relation: 'relates', direction: 'both' };
        break;
      case 'folder_type_tasks':
        subject = { kind, folderTypeId: nodeKinds[0]?.id ?? '' };
        break;
      case 'ref_field':
        subject = { kind, field: customFieldKey(refFields[0]!.id) };
        break;
      default:
        subject = { kind };
    }
    onChange(withSubject(query, subject));
  };

  /** Частичная правка параметров субъекта (вид связи, тип папки, поле). */
  const patchSubject = (patch: Record<string, unknown>) => {
    onChange(withSubject(query, { ...query.subject, ...patch } as ConditionSubject));
  };

  const addPredicateOf = (kind: ConditionPredicate['kind']): ConditionPredicate => {
    switch (kind) {
      case 'type_is':
        return { kind, typeId: types[0]?.id ?? '' };
      case 'field':
        return { kind, field: customFieldKey(definitions[0]!.id), op: 'filled' };
      case 'stage_is':
        return { kind, stageId: stagesByType.get(typeIsIds[0] ?? '')?.[0]?.id ?? '' };
      case 'system_state':
        return { kind, state: 'active' };
      case 'outcome':
        return { kind, outcome: 'success' };
      default:
        return { kind: 'result_issued' };
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {/* Какие записи */}
      <Select
        value={query.subject.kind}
        disabled={readOnly}
        onValueChange={(kind) => changeSubject(kind as ConditionSubjectKind)}
      >
        <SelectTrigger className="w-full min-w-0" aria-label={t.subject}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="nokey">
          {subjects.map((kind) => (
            <SelectItem
              key={kind}
              value={kind}
              disabled={kind === 'ref_field' && refFields.length === 0}
              title={
                kind === 'ref_field' && refFields.length === 0 ? t.subjectNoRefFields : undefined
              }
            >
              {t.subjects[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {query.subject.kind === 'self' ? null : (
        <SubjectParams
          subject={query.subject}
          nodeKinds={nodeKinds}
          refFields={refFields}
          readOnly={readOnly}
          patch={patchSubject}
        />
      )}

      {/* Условие по записи (И) */}
      {query.where.map((predicate, index) => (
        <ConditionPredicateRow
          key={`${predicate.kind}:${index}`}
          predicate={predicate}
          query={query}
          scope={scope}
          types={types}
          stagesByType={stagesByType}
          readOnly={readOnly}
          onChange={(next: ConditionPredicate) => onChange(withPredicateAt(query, index, next))}
          onRemove={() => onChange(removePredicateAt(query, index))}
        />
      ))}
      {atPredicatesLimit ? null : (
        <Select
          key={query.where.length}
          value={undefined}
          disabled={readOnly}
          onValueChange={(kind) =>
            onChange(addPredicate(query, addPredicateOf(kind as ConditionPredicate['kind'])))
          }
        >
          <SelectTrigger className="w-full min-w-0" aria-label={t.addPredicate}>
            <SelectValue placeholder={t.addPredicate} />
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            {PREDICATE_KINDS.map((kind) => (
              <SelectItem
                key={kind}
                value={kind}
                disabled={
                  (kind === 'stage_is' && !hasTypeIs) ||
                  (kind === 'field' && definitions.length === 0)
                }
                title={kind === 'stage_is' && !hasTypeIs ? t.stageNeedsType : undefined}
              >
                {t.predicates[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Сколько записей */}
      <Select
        value={query.quantifier}
        disabled={readOnly}
        onValueChange={(quantifier) =>
          onChange(setQuantifier(query, quantifier as ConditionQuery['quantifier']))
        }
      >
        <SelectTrigger className="w-full min-w-0" aria-label={t.quantifier}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="nokey">
          {(['all', 'any', 'none'] as const).map((quantifier) => (
            <SelectItem key={quantifier} value={quantifier}>
              {t.quantifiers[quantifier]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
