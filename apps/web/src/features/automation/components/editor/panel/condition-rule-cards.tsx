import type { CustomFieldModule, FormulaNode, ProcessCategory } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import {
  addCondition,
  addValidator,
  emptyConditionQuery,
  newFormulaValidator,
  newRecordsValidator,
  removeConditionAt,
  removeValidatorAt,
  updateConditionAt,
  updateValidatorAt,
} from '../../../model/condition-rules.js';
import type { Rules } from '../../../model/transition-rules.js';
import { CheckCard, ConditionCard } from './condition-rule-card.js';

const ADD_KINDS = ['records', 'formula'] as const;

/** Правила общей выборки кнопки (#635), двумя группами: «Условия» (records/
 *  formula прячут кнопку) и «Проверки» (не пускают, причина — подпись
 *  настройщика). Шесть прежних проверок остаются заготовками: их рендерит
 *  ConditionsSection и передаёт в `presets` внутрь группы «Проверки». */
export function ConditionRuleCards({
  rules,
  category,
  scope,
  typeId,
  readOnly,
  patch,
  presets = null,
}: {
  rules: Rules;
  category: ProcessCategory;
  scope: CustomFieldModule;
  typeId?: string;
  readOnly: boolean;
  patch: (rules: Rules) => void;
  /** Заготовки-пресеты (шесть прежних видов) — первыми в группе «Проверки». */
  presets?: React.ReactNode;
}) {
  const t = ui.automation.condition;
  const conditions = rules.conditions.flatMap((c) =>
    c.kind === 'records' || c.kind === 'formula' ? [c] : [],
  );
  const validators = rules.validators.flatMap((v) =>
    v.kind === 'records' || v.kind === 'formula' ? [v] : [],
  );

  const addRule = (kind: (typeof ADD_KINDS)[number], asCheck: boolean) => {
    if (kind === 'records') {
      patch(
        asCheck
          ? addValidator(rules, newRecordsValidator())
          : addCondition(rules, { kind: 'records', query: emptyConditionQuery() }),
      );
      return;
    }
    // Формула появляется с простейшей константой «истина»: карточка даёт
    // сразу заменить её настоящей формулой (редактор формул — тот же, что
    // у слотов окна).
    patch(
      asCheck
        ? addValidator(rules, newFormulaValidator(PENDING_FORMULA))
        : addCondition(rules, { kind: 'formula', formula: PENDING_FORMULA }),
    );
  };

  return (
    <>
      <span className="text-xs font-medium text-muted-foreground">{t.groupConditions}</span>
      <p className="mt-0 text-xs break-words text-muted-foreground">{t.groupConditionsHint}</p>
      {conditions.map((rule, index) => (
        <ConditionCard
          key={`${rule.kind}:${index}`}
          rule={rule}
          category={category}
          scope={scope}
          typeId={typeId}
          readOnly={readOnly}
          onChange={(next) => patch(updateConditionAt(rules, index, next))}
          onRemove={() => patch(removeConditionAt(rules, index))}
        />
      ))}
      <AddRuleSelect
        label={t.addCondition}
        readOnly={readOnly}
        onPick={(kind) => addRule(kind, false)}
      />

      <span className="pt-1 text-xs font-medium text-muted-foreground">{t.groupChecks}</span>
      <p className="mt-0 text-xs break-words text-muted-foreground">{t.groupChecksHint}</p>
      {presets}
      {validators.map((rule, index) => (
        <CheckCard
          key={`${rule.kind}:${index}`}
          rule={rule}
          category={category}
          scope={scope}
          typeId={typeId}
          readOnly={readOnly}
          onChange={(next) => patch(updateValidatorAt(rules, index, next))}
          onRemove={() => patch(removeValidatorAt(rules, index))}
        />
      ))}
      <AddRuleSelect
        label={t.addCheck}
        readOnly={readOnly}
        onPick={(kind) => addRule(kind, true)}
      />
    </>
  );
}

/** Черновая формула по умолчанию: константа «истина» — заменяется
 *  настоящей формулой в карточке (редактор открывается сразу). */
const PENDING_FORMULA: FormulaNode = { kind: 'literal', value: true };

function AddRuleSelect({
  label,
  readOnly,
  onPick,
}: {
  label: string;
  readOnly: boolean;
  onPick: (kind: (typeof ADD_KINDS)[number]) => void;
}) {
  const t = ui.automation.condition;
  return (
    <Select
      key={label}
      value={undefined}
      disabled={readOnly}
      onValueChange={(v) => onPick(v as 'records' | 'formula')}
    >
      <SelectTrigger className="w-full min-w-0" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent position="popper" className="nokey">
        {ADD_KINDS.map((kind) => (
          <SelectItem key={kind} value={kind}>
            {t.addKinds[kind]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
