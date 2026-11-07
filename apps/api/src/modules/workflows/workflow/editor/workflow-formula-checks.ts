import type {
  CustomFieldDefinition,
  CustomFieldType,
  FormulaHostKind,
  FormulaNode,
  ProcessCategory,
  TaskCreationSystemKey,
  TransitionWindowField,
  WorkflowDraftDocument,
  WorkflowProblem,
} from '@nodus/contracts';
import { customFieldIdOfKey, slotLabel, ui } from '@nodus/contracts';
import {
  validateFormula,
  type FormulaFieldMeta,
  type FormulaRegistryMeta,
} from '@nodus/formula-engine';

/**
 * Семантическая проверка формул слотов на публикации маршрута (#632, Р12;
 * A8-1). Общая грамматика (`checkWorkflowDocument` → `checkFormulaShape`)
 * ловит форму AST, но типы значений и совместимость результата с типом слота
 * выводит движок — он живёт в `@nodus/formula-engine`, который зависит от
 * contracts, а не наоборот. Поэтому серверная половина проверки здесь:
 * `validateFormula` = форма + `inferType` + матрица `FORMULA_FIELD_TYPE_COMPAT`.
 *
 * Без неё через обход клиента или устаревший черновик публиковалась формула,
 * дающая в рантайме пустой слот (не тот тип значения) или 422 на сохранении
 * значения окна. Движок берётся напрямую (чистая функция, без состояния):
 * `checkDocumentForPublish` — тоже чистая функция без DI, порт `FORMULA_ENGINE`
 * остаётся фасадом для Nest-сервисов.
 *
 * Типы системных полей слотов — зеркало редактора: форма создания
 * (`creation-slot-section.tsx`) и окно перехода (`window-field-formulas.tsx`).
 * Единый источник появится, когда эти панели получат общий модуль (сейчас
 * правки веба вне пакета) — расхождение здесь даёт ложный отказ публикации.
 */

/** Тип стандартного поля окна перехода — результат формулы обязан подходить. */
const WINDOW_SLOT_TYPES: Readonly<Partial<Record<TransitionWindowField, CustomFieldType>>> = {
  description: 'long_text',
  deadline: 'datetime',
  assignee: 'user',
  plannedMinutes: 'number',
};

/** Тип стандартного поля формы создания (#432, Р2). */
const CREATION_SLOT_TYPES: Readonly<Partial<Record<TaskCreationSystemKey, CustomFieldType>>> = {
  description: 'long_text',
  deadline: 'datetime',
  assignee: 'user',
  coexecutors: 'users',
  observers: 'users',
  priority: 'enum',
  project: 'project',
};

/** Есть ли в документе формулы слотов: без них реестр атрибутов не читается. */
export function hasSlotFormulas(doc: WorkflowDraftDocument): boolean {
  for (const t of doc.transitions) {
    if (!t.form?.enabled) continue;
    const withFormulas = t.form.sections.some(
      (section) => section.kind === 'fields' && Object.keys(section.formulas ?? {}).length > 0,
    );
    if (withFormulas) return true;
  }
  return (doc.creation?.fields ?? []).some(
    (slot) => slot.formula !== null && slot.formula !== undefined,
  );
}

export interface WorkflowFormulaFacts {
  category: ProcessCategory;
  /** Реестр атрибутов: номер → тип (тайпинг) и имя (сообщение о проблеме). */
  definitions: readonly CustomFieldDefinition[];
}

interface SlotTarget {
  /** Подпись слота для сообщения — человек ищет проблему по названию поля. */
  label: string;
  /** Тип слота; null — не выводится (удалённый атрибут уже отмечен отдельно). */
  type: CustomFieldType | null;
  /** Формула типа/вида: без related и цепочки папок (у создания записи нет). */
  typeDefault: boolean;
}

/**
 * Проверка формул слотов движком: для каждой формулы окна и формы создания —
 * тип результата и совместимость с типом поля. Возвращает проблемы
 * публикации (код `formula_invalid`); структурные отказы уже показаны общей
 * грамматикой, поэтому здесь только типовые — иначе одна формула давала бы
 * две плашки в списке проблем.
 */
export function checkWorkflowFormulas(
  doc: WorkflowDraftDocument,
  facts: WorkflowFormulaFacts,
): WorkflowProblem[] {
  const problems: WorkflowProblem[] = [];
  const { definitions } = facts;
  const hostKind: FormulaHostKind = facts.category === 'letter' ? 'letter' : 'task';
  const meta = registryMetaOf(definitions);

  const check = (
    ast: FormulaNode,
    target: SlotTarget,
    refs: Pick<WorkflowProblem, 'transitionId' | 'creationField'>,
  ): void => {
    const validation = validateFormula(ast, {
      hostKind,
      meta,
      typeDefault: target.typeDefault,
      ...(target.type ? { targetFieldType: target.type } : {}),
    });
    const blocking = validation.issues.filter((issue) => issue.blocking);
    if (blocking.length === 0) return;
    if (blocking.some((issue) => issue.code !== 'type_mismatch')) return;
    problems.push({
      code: 'formula_invalid',
      severity: 'error',
      ...refs,
      detail: detailOf(target),
    });
  };

  for (const t of doc.transitions) {
    if (!t.form?.enabled) continue;
    for (const section of t.form.sections) {
      if (section.kind !== 'fields') continue;
      for (const [key, ast] of Object.entries(section.formulas ?? {})) {
        // Окно открывается у существующей записи: related разрешён (как в
        // редакторе, `WindowFieldFormulas` → allowRelated).
        check(
          ast,
          {
            label: windowSlotLabel(key, definitions),
            type: slotFieldType(key, definitions, WINDOW_SLOT_TYPES),
            typeDefault: false,
          },
          { transitionId: t.id },
        );
      }
    }
  }
  for (const slot of doc.creation?.fields ?? []) {
    const ast = slot.formula;
    if (ast === null || ast === undefined) continue;
    // Запись ещё не создана: related и цепочка папок недоступны (как в
    // редакторе, `CreationSlotSection` → typeDefault).
    check(
      ast,
      {
        label: slotLabel(slot, { definitions }),
        type: slotFieldType(slot.key, definitions, CREATION_SLOT_TYPES),
        typeDefault: true,
      },
      { creationField: slot.key },
    );
  }
  return problems;
}

/** Подпись поля окна: имя атрибута или стандартное название поля карточки. */
function windowSlotLabel(key: string, definitions: readonly CustomFieldDefinition[]): string {
  const id = customFieldIdOfKey(key);
  if (id !== null) {
    return definitions.find((definition) => definition.id === id)?.name ?? key;
  }
  return ui.automation.requirableFields[key as TransitionWindowField] ?? key;
}

/** Тип поля слота: атрибут — тип определения, системное поле — таблица. */
function slotFieldType(
  key: string,
  definitions: readonly CustomFieldDefinition[],
  systemTypes: Readonly<Partial<Record<string, CustomFieldType>>>,
): CustomFieldType | null {
  const id = customFieldIdOfKey(key);
  if (id !== null) return definitions.find((definition) => definition.id === id)?.type ?? null;
  return systemTypes[key] ?? null;
}

/** Мета реестра для тайпинга: номер → тип и справочник (как `metaOf`). */
function registryMetaOf(definitions: readonly CustomFieldDefinition[]): FormulaRegistryMeta {
  const byNumber = new Map<number, FormulaFieldMeta>();
  for (const definition of definitions) {
    byNumber.set(definition.number, {
      number: definition.number,
      type: definition.type,
      dictionaryId: definition.dictionary?.id ?? definition.settings.dictionaryId ?? null,
    });
  }
  return { byNumber };
}

/** Деталь проблемы: слот и тип поля — «что именно не подходит». */
function detailOf(target: SlotTarget): string {
  const type = target.type ? ` — ${ui.customFields.types[target.type]}` : '';
  return `«${target.label}»: ${ui.formulas.errors.type_mismatch}${type}`;
}
