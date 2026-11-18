import type { WorkflowCondition } from '@nodus/contracts';

import type { CatalogProcessType, CatalogStage, CatalogWorkflow } from './system-catalog.js';

/**
 * Системные типы «Комплект» и «Изменение» (#467): маршрут Вашурова — 8
 * стадий ЛИНЕЙНО (каждый следующий шаг — переход с предыдущей; жмут
 * ответственный и постановщик). Категория task; ревизия каталога своя
 * (KIT_CATALOG_REVISION): правки задач/писем эти маршруты не перезасевают.
 * Ревизия 2 — значок «Комплекта»: лист бумаги с загнутым углом (file-text,
 * вердикт владельца 31.10), прежний package.
 * Регистрация — в CATALOG_PROCESS_TYPES (system-catalog.ts); имя,
 * занятое пользовательским типом, — skip+warn в бутстрапе (не падаем).
 */

const KIT_CATALOG_REVISION = 2;

const owners: WorkflowCondition = { kind: 'role_in', roles: ['assignee', 'creator'] };

/** Линейный маршрут по списку стадий: переход-шаг между соседними. */
function linearWorkflow(def: {
  code: string;
  name: string;
  stages: readonly CatalogStage[];
  transitionNames: readonly string[];
}): CatalogWorkflow {
  return {
    code: def.code,
    name: def.name,
    kind: 'task',
    revision: KIT_CATALOG_REVISION,
    stages: [...def.stages],
    transitions: def.stages.slice(1).map((stage, index) => ({
      code: `to_${stage.code}`,
      name: def.transitionNames[index]!,
      from: def.stages[index]!.code,
      to: stage.code,
      display: 'primary',
      rules: { conditions: [owners] },
    })),
  };
}

/** Общий хвост маршрутов Вашурова: стадии 2–8 (первую задаёт тип). */
const STAGES_TAIL: readonly CatalogStage[] = [
  {
    code: 'sent_for_review',
    name: 'Передано заказчику на просмотр',
    color: 'info',
    systemState: 'active',
  },
  { code: 'remarks_received', name: 'Замечания получены', color: 'warning', systemState: 'active' },
  { code: 'agreed', name: 'Согласовано', color: 'success', systemState: 'active' },
  { code: 'sent_to_print', name: 'Выдано в печать', color: 'info', systemState: 'active' },
  { code: 'handed_over', name: 'Передано по накладной', color: 'success', systemState: 'active' },
  {
    code: 'state_review',
    name: 'Согласование в госорганах',
    color: 'warning',
    systemState: 'active',
  },
  { code: 'finished', name: 'Завершено', color: 'info', systemState: 'closed', outcome: 'success' },
];

const TRANSITION_NAMES = [
  'Передать заказчику на просмотр',
  'Получить замечания',
  'Согласовать',
  'Выдать в печать',
  'Передать по накладной',
  'Направить в госорганы',
  'Завершить',
] as const;

const STAGES_HEAD: readonly CatalogStage[] = [
  {
    code: 'in_development',
    name: 'В разработке',
    color: 'neutral',
    systemState: 'backlog',
    isInitial: true,
  },
];

export const KIT_PROCESS_TYPE: CatalogProcessType = {
  code: 'kit',
  name: 'Комплект',
  category: 'task',
  icon: 'file-text',
  color: 'info',
  description: 'Маршрут комплектации документа: от разработки до госорганов',
  sortOrder: 2,
  // Работа внутри проекта-комплекта: без проекта не создаётся (#665).
  withoutProject: false,
};

export const CHG_PROCESS_TYPE: CatalogProcessType = {
  code: 'chg',
  name: 'Изменение',
  category: 'task',
  icon: 'pencil-ruler',
  color: 'warning',
  description: 'Маршрут изменения: от разработки до госорганов',
  sortOrder: 3,
  // Изменение живёт в папке-комплекте проекта (#665, ADR-0042 §11).
  withoutProject: false,
};

export const KIT_CATALOG_PROCESS_TYPES: readonly {
  type: CatalogProcessType;
  workflow: CatalogWorkflow;
}[] = [
  {
    type: KIT_PROCESS_TYPE,
    workflow: linearWorkflow({
      code: 'task.kit',
      name: 'Комплект',
      stages: [...STAGES_HEAD, ...STAGES_TAIL],
      transitionNames: TRANSITION_NAMES,
    }),
  },
  {
    type: CHG_PROCESS_TYPE,
    workflow: linearWorkflow({
      code: 'task.chg',
      name: 'Изменение',
      stages: [...STAGES_HEAD, ...STAGES_TAIL],
      transitionNames: TRANSITION_NAMES,
    }),
  },
];
