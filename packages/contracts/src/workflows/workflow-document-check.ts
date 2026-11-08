import { customFieldIdOfKey } from '../custom-fields/custom-field-key.js';
import type { CustomFieldDefinition } from '../custom-fields/custom-field.schemas.js';
import { checkCreationForm } from './creation-form.js';
import type { ProcessCategory } from './process-type.schemas.js';
import { checkCategoryDictionary } from './workflow-document-category-check.js';
import { checkDeciderRules, type WorkflowPositionFact } from './workflow-document-deciders.js';
import { checkExtraRules } from './workflow-document-extra-checks.js';
import { checkFormulaSlots } from './workflow-document-formula-check.js';
import type {
  WorkflowDraftDocument,
  WorkflowDraftStage,
  WorkflowDraftTransition,
  WorkflowProblem,
} from './workflow-document.schemas.js';

/**
 * Проверка документа маршрута (#378, ADR-0021) — чистая функция без
 * состояния и I/O; работает и в редакторе (живые подсказки), и на сервере
 * (публикация отклоняется при ошибках). Это исключение из «без логики в
 * contracts» (patterns.md): грамматика документа обязана совпадать
 * байт-в-байт на фронте и бэке.
 */

const MAX_STAGES = 20;
const MAX_TRANSITIONS = 80;

/** Факты атрибутов для проверки ссылок (#431, Р7): все id реестра. Без
 *  `customFields` проверки пропускаются (старые вызовы и тесты остаются
 *  валидными). Привязка к типу: атрибут, которого нет у типа, не
 *  выбирается в его форме, окнах и условиях. Глобального скрытия нет
 *  (О2 #631) — видимость регулирует место. */
export interface WorkflowCustomFieldFacts {
  active: ReadonlySet<string>;
  /** id атрибутов, привязанных к типу процесса (Р8); без набора проверка
   *  привязки пропускается. */
  inType?: ReadonlySet<string>;
}

export interface WorkflowCheckOptions {
  customFields?: WorkflowCustomFieldFacts;
  /** Категория типа — нужна для формы создания (#432) и словаря категории
   *  (#55: роли, разделы, гейты, пост-действия). Без неё эти проверки
   *  пропускаются (старые вызовы валидны). */
  category?: ProcessCategory;
  /** У типа настроена серия номеров (#55) — для `numbering_not_configured`. */
  numberingConfigured?: boolean;
  /** Поля типа и его counter-поля с правилом серии (#630, Р5): цель
   *  «Присвоить номер» задачи проверяется словарём категории. */
  customFieldIds?: readonly string[];
  counterFieldIds?: readonly string[];
  /** Определения — тип и настройки для проверки пресетов. */
  definitions?: readonly Pick<CustomFieldDefinition, 'id' | 'type' | 'settings'>[];
  /** Модуль проектов включён (поле «Проект» доступно в форме). */
  projectsAvailable?: boolean;
  /** Живые сотрудники — пресеты «ответственный/соисполнители/наблюдатели». */
  activeUserIds?: ReadonlySet<string>;
  /** Имена статусов других опубликованных маршрутов (#430), уже без
   *  текущего маршрута: для warning-ов `stage_name_shared` и
   *  `stage_name_similar`. Без факта проверки имён пропускаются. */
  stageNameFacts?: readonly {
    systemState: WorkflowDraftStage['systemState'];
    name: string;
  }[];
  /** Ограничить проверку имён новыми/переименованными стадиями (#430). */
  stageNameStageIds?: ReadonlySet<string>;
  /** Факты должностей для источников решающих (#433): активность и число
   *  живых держателей. Без факта проверки должности пропускаются. */
  positions?: ReadonlyMap<string, WorkflowPositionFact>;
}

function error(
  code: WorkflowProblem['code'],
  refs: Pick<WorkflowProblem, 'stageId' | 'transitionId'> = {},
): WorkflowProblem {
  return { code, severity: 'error', ...refs };
}

function warning(
  code: WorkflowProblem['code'],
  refs: Pick<WorkflowProblem, 'stageId' | 'transitionId'> = {},
): WorkflowProblem {
  return { code, severity: 'warning', ...refs };
}

/** Переходы, которыми можно ВЫЙТИ из стадии: свои + «из любого». Для
 *  незамкнутых стадий (только их проверяет dead_end) любое «из любого» —
 *  выход; правило «итог → итог» (ADR-0020 дополнение) гасит «из любого»
 *  лишь между двумя закрытыми стадиями — это учтено в closed_without_exit. */
function exitsFrom(stage: WorkflowDraftStage, transitions: readonly WorkflowDraftTransition[]) {
  return transitions.filter((t) => t.fromStageId === stage.id || t.fromStageId === null);
}

/**
 * Живые проверки схемы. Ошибки запрещают публикацию, предупреждения — нет.
 * Порядок детерминирован: правила по порядку таблицы спеки, элементы — по
 * массиву документа (устойчивые подсказки в UI).
 */
export function checkWorkflowDocument(
  doc: WorkflowDraftDocument,
  opts: WorkflowCheckOptions = {},
): WorkflowProblem[] {
  const { stages, transitions } = doc;
  const problems: WorkflowProblem[] = [];
  const byId = new Map(stages.map((s) => [s.id as string, s]));

  // --- Структура -----------------------------------------------------------

  if (stages.length > MAX_STAGES) problems.push(error('too_many_stages'));
  if (transitions.length > MAX_TRANSITIONS) problems.push(error('too_many_transitions'));

  const initialStages = stages.filter((s) => s.isInitial);
  if (initialStages.length === 0) problems.push(error('no_initial'));
  if (initialStages.length > 1) problems.push(error('multiple_initial'));

  // --- Имена и дубликаты ---------------------------------------------------

  for (const s of stages) {
    if (s.name.trim().length === 0) problems.push(error('empty_name', { stageId: s.id }));
  }
  for (const t of transitions) {
    if (t.name.trim().length === 0) problems.push(error('empty_name', { transitionId: t.id }));
  }

  const seenStageNames = new Set<string>();
  for (const s of stages) {
    const key = s.name.trim().toLowerCase();
    if (key.length === 0) continue;
    if (seenStageNames.has(key)) problems.push(error('duplicate_stage_name', { stageId: s.id }));
    seenStageNames.add(key);
  }

  // «Видимые» кнопки (не в меню) из одного статуса с одним названием.
  const seenButtonKeys = new Set<string>();
  for (const t of transitions) {
    const name = t.name.trim().toLowerCase();
    if (name.length === 0 || t.display === 'menu') continue;
    const key = `${t.fromStageId ?? '*'}→${name}`;
    if (seenButtonKeys.has(key)) {
      problems.push(error('duplicate_button_name', { transitionId: t.id }));
    }
    seenButtonKeys.add(key);
  }

  // --- Кнопки: петли, роли, главные, route_if ------------------------------

  for (const t of transitions) {
    if (t.fromStageId !== null && t.fromStageId === t.toStageId) {
      problems.push(error('self_loop', { transitionId: t.id }));
    }
    if (t.rules.conditions.length === 0) {
      problems.push(error('no_roles', { transitionId: t.id }));
    }
    // Кнопка-действие, у которой «кто видит» задан только правом (#430):
    // в «Мои действия» держателем станет ответственный — предупреждаем.
    // У писем «Моих действий» нет — не шумим на системном маршруте письма.
    if (
      opts.category !== 'letter' &&
      t.intent === 'action' &&
      t.rules.conditions.length > 0 &&
      t.rules.conditions.every((c) => c.kind === 'permission')
    ) {
      problems.push(warning('action_without_visibility', { transitionId: t.id }));
    }
  }

  const seenPrimary = new Set<string>();
  for (const t of [...transitions].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (t.display !== 'primary') continue;
    const key = t.fromStageId ?? '*';
    if (seenPrimary.has(key)) problems.push(error('multiple_primary', { transitionId: t.id }));
    seenPrimary.add(key);
  }

  for (const t of transitions) {
    for (const pf of t.rules.postFunctions) {
      if (pf.kind !== 'route_if') continue;
      const targetExists = byId.has(pf.toStageId);
      const sameAsDirect = pf.toStageId === t.toStageId;
      if (!targetExists || sameAsDirect) {
        problems.push(error('route_if_invalid', { transitionId: t.id }));
      }
    }
  }

  // --- Окно при нажатии (#380) --------------------------------------------

  for (const t of transitions) {
    const form = t.form;
    if (!form?.enabled) continue;
    const kinds = new Set<string>();
    for (const section of form.sections) {
      if (kinds.has(section.kind)) {
        problems.push(error('form_duplicate_section', { transitionId: t.id }));
      }
      kinds.add(section.kind);
      if (
        (section.kind === 'result_files' || section.kind === 'comment') &&
        section.label.trim().length === 0
      ) {
        problems.push(error('form_empty_label', { transitionId: t.id }));
      }
    }
    const hasResult = kinds.has('result');
    const files = form.sections.find((s) => s.kind === 'result_files');
    const hasFilesGate = t.rules.validators.some((v) => v.kind === 'result_files');
    if (files && !hasFilesGate && !hasResult) {
      problems.push(warning('form_useless_section', { transitionId: t.id }));
    }
    const messages = form.sections.find((s) => s.kind === 'result_messages');
    if (messages?.kind === 'result_messages' && !messages.required && !hasResult) {
      problems.push(warning('form_useless_section', { transitionId: t.id }));
    }
  }

  // --- Формулы слотов окна и формы создания (#632, Р12) --------------------

  if (opts.category) problems.push(...checkFormulaSlots(doc, opts.category));

  // --- Кастомные поля в окне и гейтах (#431, Р7) ---------------------------

  const fields = opts.customFields;
  if (fields) {
    const checkKey = (key: string, refs: Pick<WorkflowProblem, 'transitionId'>): void => {
      const id = customFieldIdOfKey(key);
      if (id === null) return;
      if (!fields.active.has(id)) {
        problems.push(error('custom_field_unknown', refs));
      } else if (fields.inType && !fields.inType.has(id)) {
        // Атрибут чужого типа не выбирается в его окнах и условиях (#432, Р8).
        problems.push(error('custom_field_not_in_type', refs));
      }
    };
    for (const t of transitions) {
      for (const section of t.form?.enabled ? t.form.sections : []) {
        if (section.kind === 'fields') {
          for (const key of section.fields) checkKey(key, { transitionId: t.id });
        }
      }
      for (const validator of t.rules.validators) {
        if (validator.kind === 'fields_required') {
          for (const key of validator.fields) checkKey(key, { transitionId: t.id });
        }
      }
      // Источник «поле» у решающих (#433): тот же контроль удалённых и
      // непривязанных к типу атрибутов, что у окна и гейтов.
      for (const condition of t.rules.conditions) {
        if (condition.kind === 'decider_in' && condition.source.kind === 'field') {
          checkKey(condition.source.field, { transitionId: t.id });
        }
      }
    }
  }

  // --- Решающие (#433): источники, должности, окно без прав участника -------

  checkDeciderRules(
    doc,
    {
      definitions: opts.definitions,
      positions: opts.positions,
    },
    problems,
  );

  // --- Словарь категории (#55, Р6) и форма создания (#432) ---------------

  if (opts.category) {
    problems.push(
      ...checkCategoryDictionary(doc, {
        category: opts.category,
        numberingConfigured: opts.numberingConfigured,
        customFieldIds: opts.customFieldIds,
        counterFieldIds: opts.counterFieldIds,
      }),
    );
  }
  if (doc.creation && opts.category && fields) {
    problems.push(
      ...checkCreationForm(doc.creation, {
        category: opts.category,
        customFields: {
          active: fields.active,
          inType: fields.inType ?? new Set(fields.active),
        },
        definitions: opts.definitions,
        projectsAvailable: opts.projectsAvailable,
        activeUserIds: opts.activeUserIds,
      }),
    );
  }

  // --- Итог ----------------------------------------------------------------

  for (const s of stages) {
    const hasOutcome = s.outcome !== null;
    if (s.systemState === 'closed' && !hasOutcome) {
      problems.push(error('outcome_mismatch', { stageId: s.id }));
    }
    if (s.systemState !== 'closed' && hasOutcome) {
      problems.push(error('outcome_mismatch', { stageId: s.id }));
    }
  }

  // --- Достижимость и тупики ----------------------------------------------

  // Рёбра для BFS: свои переходы + «из любого» (правило «итог → итог» гасит
  // «из любого» между двумя закрытыми стадиями — такой путь не проходим).
  const neighbors = (stage: WorkflowDraftStage): string[] => {
    const result: string[] = [];
    for (const t of transitions) {
      if (t.fromStageId === stage.id) {
        result.push(t.toStageId);
      } else if (t.fromStageId === null) {
        const target = byId.get(t.toStageId);
        if (!(stage.systemState === 'closed' && target?.systemState === 'closed')) {
          result.push(t.toStageId);
        }
      }
    }
    return result;
  };

  const initial = initialStages.length === 1 ? initialStages[0] : null;
  if (initial) {
    const reachable = new Set<string>([initial.id]);
    const queue = [initial];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const nextId of neighbors(current)) {
        if (!reachable.has(nextId)) {
          reachable.add(nextId);
          const next = byId.get(nextId);
          if (next) queue.push(next);
        }
      }
    }
    for (const s of stages) {
      if (!reachable.has(s.id)) problems.push(error('unreachable_stage', { stageId: s.id }));
    }
    const canClose = stages.some((s) => s.systemState === 'closed' && reachable.has(s.id));
    if (!canClose) problems.push(error('no_closed_stage'));
  }

  for (const s of stages) {
    if (s.systemState === 'closed') continue;
    if (exitsFrom(s, transitions).length === 0) {
      problems.push(error('dead_end_stage', { stageId: s.id }));
    }
  }

  // --- Предупреждения ------------------------------------------------------

  for (const s of stages) {
    // Закрытые статусы не штрафуются: у «Итога» нет пути вперёд, их
    // собственное предупреждение — closed_without_exit.
    if (s.systemState === 'closed') continue;
    const own = transitions.filter((t) => t.fromStageId === s.id);
    if (own.length > 0 && !own.some((t) => t.display === 'primary')) {
      problems.push(warning('no_primary', { stageId: s.id }));
    }
  }

  for (const s of stages) {
    if (s.systemState !== 'closed') continue;
    const hasExit = transitions.some(
      (t) =>
        t.fromStageId === s.id ||
        // «из любого» возвращает из итога, только если цель открыта.
        (t.fromStageId === null && byId.get(t.toStageId)?.systemState !== 'closed'),
    );
    if (!hasExit) problems.push(warning('closed_without_exit', { stageId: s.id }));
  }

  const anyTargets = new Set(
    transitions.filter((t) => t.fromStageId === null).map((t) => t.toStageId),
  );
  for (const t of transitions) {
    if (t.fromStageId !== null && anyTargets.has(t.toStageId)) {
      problems.push(warning('duplicate_with_any', { transitionId: t.id }));
    }
  }

  // #430: имена статусов, дубли целей и разрешимость approver_is_actor.
  checkExtraRules(
    doc,
    { stageNameFacts: opts.stageNameFacts, stageNameStageIds: opts.stageNameStageIds },
    problems,
  );

  return problems;
}

/** Есть ли ошибки, запрещающие публикацию. */
export function hasBlockingProblems(problems: readonly WorkflowProblem[]): boolean {
  return problems.some((p) => p.severity === 'error');
}
