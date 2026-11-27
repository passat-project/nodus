import type { CustomFieldModule, ProcessCategory } from '@nodus/contracts';
import { CONDITION_LIMITS, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { X } from 'lucide-react';

import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { TypeFormulaControl } from '../../../../../shared/custom-fields/formula/type-formula-control.js';
import { PanelField } from '../../../../../shared/ui/panel/panel-kit.js';
import {
  withOverridePolicy,
  type CheckValidator,
  type ConditionRule,
} from '../../../model/condition-rules.js';
import { OverrideEditor } from './condition-override-editor.js';
import { ConditionQueryEditor } from './condition-query-editor.js';

/** Общие пропсы карточки правила (условие или проверка). */
interface CardProps {
  category: ProcessCategory;
  scope: CustomFieldModule;
  /** Тип маршрута: поле-ссылка и атрибуты — из привязанных к нему. */
  typeId?: string;
  readOnly: boolean;
}

/** Рамка карточки правила: заголовок-вид и удаление. */
function RuleCardShell({
  title,
  readOnly,
  onRemove,
  children,
}: {
  title: string;
  readOnly: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-medium">{title}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={readOnly}
          aria-label={ui.automation.condition.removeRule}
          onClick={onRemove}
        >
          <X />
        </Button>
      </div>
      {children}
    </div>
  );
}

/** Условие (прячет кнопку): конструктор выборки без подписи и обхода. */
export function ConditionCard({
  rule,
  category,
  scope,
  typeId,
  readOnly,
  onChange,
  onRemove,
}: CardProps & {
  rule: ConditionRule;
  onChange: (rule: ConditionRule) => void;
  onRemove: () => void;
}) {
  const t = ui.automation.condition;
  const { data: definitions = [] } = useCustomFieldDefinitions(scope);
  if (rule.kind === 'records') {
    return (
      <RuleCardShell title={t.addKinds.records} readOnly={readOnly} onRemove={onRemove}>
        <ConditionQueryEditor
          query={rule.query}
          category={category}
          scope={scope}
          typeId={typeId}
          readOnly={readOnly}
          onChange={(query) => onChange({ ...rule, query })}
        />
      </RuleCardShell>
    );
  }
  return (
    <RuleCardShell title={t.addKinds.formula} readOnly={readOnly} onRemove={onRemove}>
      <p className="text-xs break-words text-muted-foreground">{t.formulaLead}</p>
      <TypeFormulaControl
        hostKind={category}
        targetType="bool"
        label={t.addKinds.formula}
        ownDefinitions={definitions}
        value={rule.formula}
        readOnly={readOnly}
        onChange={(formula) => formula && onChange({ kind: 'formula', formula })}
      />
    </RuleCardShell>
  );
}

/** Проверка (не пускает): подпись причины + выборка/формула + обход. */
export function CheckCard({
  rule,
  category,
  scope,
  typeId,
  readOnly,
  onChange,
  onRemove,
}: CardProps & {
  rule: CheckValidator;
  onChange: (rule: CheckValidator) => void;
  onRemove: () => void;
}) {
  const t = ui.automation.condition;
  const { data: definitions = [] } = useCustomFieldDefinitions(scope);
  const titleEmpty = !rule.title.trim();
  return (
    <RuleCardShell
      title={rule.title.trim() || t.addKinds[rule.kind]}
      readOnly={readOnly}
      onRemove={onRemove}
    >
      <PanelField label={t.checkTitle} hint={titleEmpty ? t.checkTitleHint : undefined}>
        <Input
          value={rule.title}
          maxLength={CONDITION_LIMITS.titleLength}
          readOnly={readOnly}
          aria-invalid={titleEmpty}
          placeholder={t.checkTitlePlaceholder}
          onChange={(event) => onChange({ ...rule, title: event.target.value } as CheckValidator)}
        />
      </PanelField>

      {rule.kind === 'records' ? (
        <ConditionQueryEditor
          query={rule.query}
          category={category}
          scope={scope}
          typeId={typeId}
          readOnly={readOnly}
          onChange={(query) => onChange({ ...rule, query })}
        />
      ) : (
        <>
          <p className="text-xs break-words text-muted-foreground">{t.formulaLead}</p>
          <TypeFormulaControl
            hostKind={category}
            targetType="bool"
            label={t.checkTitle}
            ownDefinitions={definitions}
            value={rule.formula}
            readOnly={readOnly}
            onChange={(formula) =>
              onChange({ ...rule, formula: formula ?? rule.formula } as CheckValidator)
            }
          />
        </>
      )}

      <OverrideEditor
        policy={rule.override}
        readOnly={readOnly}
        onChange={(override) => onChange(withOverridePolicy(rule, override))}
      />
    </RuleCardShell>
  );
}
