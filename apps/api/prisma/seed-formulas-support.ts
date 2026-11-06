/**
 * Опоры демо-мира формул (#632, пакет 2c): общий JSON данных, песочный гейт,
 * идемпотентные помощники реестра атрибутов и сборка AST формул.
 *
 * Один источник id и ожидаемых значений — `tests/e2e/formula-demo.json`
 * (прецедент `e2e-users.json`, #247): сид кладёт данные, e2e-спеки проверяют их.
 */
import { readFileSync } from 'node:fs';

import type { CustomFieldType, FormulaNode, TransitionForm } from '@nodus/contracts';
import { transitionFormSchema, workflowTransitionRulesSchema } from '@nodus/contracts';
import { validateFormula, type FormulaFieldMeta } from '@nodus/formula-engine';

import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';

export interface DemoTask {
  id: string;
  title: string;
  number: number;
  mark: string;
  cipher: string;
  movedCipher?: string;
}

export interface FormulaDemo {
  project: { id: string; name: string; cipher: string };
  secretProject: { id: string; name: string; cipher: string };
  buildings: Record<'one' | 'two' | 'secret', { id: string; name: string; gp: string }>;
  tasks: Record<'komplektA' | 'komplektB' | 'confidential' | 'secret', DemoTask>;
  fields: Record<
    'cipher' | 'number' | 'marka' | 'buildingGp' | 'issue' | 'coefficient',
    { id: string; name: string; prefill?: string }
  >;
  typeName: string;
  transitionName: string;
}

export const DEMO: FormulaDemo = JSON.parse(
  readFileSync(new URL('../../../tests/e2e/formula-demo.json', import.meta.url), 'utf8'),
) as FormulaDemo;

/** Песочная БД (авто-изоляция live-stack) либо явное включение (стенд CI). */
export function formulaDemoEnabled(databaseUrl: string | undefined): boolean {
  if (process.env.SEED_FORMULA_DEMO === '1') return true;
  if (!databaseUrl) return false;
  try {
    return new URL(databaseUrl).pathname === '/nodus_night';
  } catch {
    return false;
  }
}

/** Номера атрибутов, на которые ссылаются формулы мира (адрес в AST). */
export interface FormulaNumbers {
  projectCode: number;
  buildingGp: number;
  marka: number;
  komplektNumber: number;
  kindId: string;
}

/** Определение атрибута по id; имя занято другим id — переиспользуем его. */
export async function ensureDefinition(
  prisma: PrismaClient,
  def: { id: string; name: string; type: CustomFieldType; hint?: string; sortOrder: number },
): Promise<{ id: string; number: number }> {
  const byId = await prisma.fieldDefinition.findUnique({
    where: { id: def.id },
    select: { id: true, number: true },
  });
  if (byId) return byId;
  const byName = await prisma.fieldDefinition.findFirst({
    where: { name: { equals: def.name, mode: 'insensitive' } },
    select: { id: true, number: true },
  });
  if (byName) return byName;
  // Номер — sequence реестра (#631 Р2): адрес атрибута в формулах. Выдаёт его
  // репозиторий в транзакции создания; сид берёт тем же nextval.
  const rows = await prisma.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`SELECT nextval('field_definitions_number_seq') AS n`,
  );
  const next = rows[0]?.n;
  if (next === undefined) throw new Error('seed формул: sequence номеров атрибутов пуст');
  return prisma.fieldDefinition.create({
    data: {
      id: def.id,
      number: Number(next),
      type: def.type,
      name: def.name,
      hint: def.hint ?? null,
      settings: {},
      sortOrder: def.sortOrder,
    },
    select: { id: true, number: true },
  });
}

/** Привязка «атрибут × место»; формула места пишется только при создании
 *  (правку администратора ре-сид не перетирает — политика сида). */
export async function bind(
  prisma: PrismaClient,
  definitionId: string,
  targetKind: 'process_type' | 'node_kind',
  targetId: string,
  defaultFormula?: FormulaNode,
): Promise<void> {
  await prisma.fieldBinding.upsert({
    where: { definitionId_targetKind_targetId: { definitionId, targetKind, targetId } },
    update: {},
    create: {
      definitionId,
      targetKind,
      targetId,
      ...(defaultFormula
        ? { defaultFormula: defaultFormula as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
}

/** Слот формы вида папки: без него атрибут не виден в форме создания папки. */
export async function addKindSlot(
  prisma: PrismaClient,
  kindId: string,
  fieldId: string,
): Promise<void> {
  const kind = await prisma.nodeKind.findUnique({
    where: { id: kindId },
    select: { config: true },
  });
  const config = (kind?.config ?? {}) as {
    form?: { fields?: { fieldId: string; state: string }[] };
    capabilities?: string[];
  };
  const fields = config.form?.fields ?? [];
  if (fields.some((slot) => slot.fieldId === fieldId)) return;
  const next = {
    ...config,
    form: { ...(config.form ?? {}), fields: [...fields, { fieldId, state: 'optional' }] },
  };
  await prisma.nodeKind.update({
    where: { id: kindId },
    data: { config: next as Prisma.InputJsonValue },
  });
}

/** Шифр комплекта (критерий 1): шифр проекта — № по ГП здания — марка+номер.
 *  Склейка соседними операндами: марка и номер стоят подряд («КЖ1»). */
export function cipherFormula(numbers: FormulaNumbers): FormulaNode {
  return {
    kind: 'op',
    op: 'concat',
    args: [
      { kind: 'field', source: { kind: 'project' }, number: numbers.projectCode, name: 'Шифр' },
      { kind: 'literal', value: '-' },
      {
        kind: 'field',
        source: { kind: 'folder_nearest', kindId: numbers.kindId },
        number: numbers.buildingGp,
        name: '№ по ГП',
      },
      { kind: 'literal', value: '-' },
      { kind: 'field', source: { kind: 'self' }, number: numbers.marka, name: 'Марка' },
      {
        kind: 'field',
        source: { kind: 'self' },
        number: numbers.komplektNumber,
        name: 'Номер комплекта',
      },
    ],
  };
}

/** Подстановка окна «Изм. на момент выдачи» (критерий 3): читает только
 *  ХРАНИМЫЕ значения (формула типа в БД не материализуется — Р6), поэтому
 *  источники — проект и папка-здание, а не «Шифр комплекта». */
export function issueFormula(numbers: FormulaNumbers): FormulaNode {
  return {
    kind: 'op',
    op: 'concat',
    args: [
      { kind: 'field', source: { kind: 'project' }, number: numbers.projectCode, name: 'Шифр' },
      { kind: 'literal', value: '-' },
      {
        kind: 'field',
        source: { kind: 'folder_nearest', kindId: numbers.kindId },
        number: numbers.buildingGp,
        name: '№ по ГП',
      },
      { kind: 'literal', value: '-' },
      {
        kind: 'field',
        source: { kind: 'self' },
        number: numbers.komplektNumber,
        name: 'Номер комплекта',
      },
    ],
  };
}

/** Проверка AST контрактом языка (форма + типы + совместимость с атрибутом):
 *  сид падает, если данные разошлись с языком, а не кладёт в БД мусор. */
export function assertFormula(
  ast: FormulaNode,
  meta: Map<number, FormulaFieldMeta>,
  targetFieldType: CustomFieldType,
  typeDefault: boolean,
): void {
  const result = validateFormula(ast, {
    hostKind: 'task',
    meta: { byNumber: meta },
    targetFieldType,
    typeDefault,
  });
  if (!result.ok) {
    throw new Error(
      `seed формул (#632): формула не проходит контракт — ${JSON.stringify(result.issues)}`,
    );
  }
}

// ===== Маршрут «Комплекта»: общие константы и документ окна =====

/** Детерминированные id демо-маршрута (свежая песочница). */
export const ROUTE_IDS = {
  type: 'c0000000-0000-4000-8000-000000000401',
  workflow: 'c0000000-0000-4000-8000-000000000402',
  stageDevelopment: 'c0000000-0000-4000-8000-000000000411',
  stagePrint: 'c0000000-0000-4000-8000-000000000412',
  stageFinished: 'c0000000-0000-4000-8000-000000000413',
  transitionPrint: 'c0000000-0000-4000-8000-000000000421',
  transitionFinish: 'c0000000-0000-4000-8000-000000000422',
  transitionBack: 'c0000000-0000-4000-8000-000000000423',
} as const;

/** Код типа — системный (`kit`): каталог находит тип по коду, не плодит дубль. */
export const TYPE_CODE = 'kit';
export const WORKFLOW_CODE = 'task.kit';
/** Код кнопки выдачи в системном маршруте «Комплекта» (system-catalog-kit.ts). */
export const PRINT_CODE = 'to_sent_to_print';
/** Кнопка возврата: демо-мир переиспользуем (повторный прогон приёмки). */
export const BACK_CODE = 'to_development';
export const BACK_NAME = 'Вернуть в разработку';
/** Ревизия каталога «Комплекта» — маркер «наше не старше каталога». */
export const CATALOG_REVISION = 2;

export interface KomplektRoute {
  typeId: string;
  workflowId: string;
  stageIds: { initial: string };
}

export interface RouteArgs {
  adminId: string;
  typeName: string;
  transitionName: string;
  issueFieldId: string;
  issueFormula: FormulaNode;
}

/** Окно выдачи: поле-атрибут «Изм.» с формулой-подстановкой (критерий 3). */
export function buildIssueForm(args: RouteArgs): TransitionForm {
  const issueKey = `cf.${args.issueFieldId}`;
  return transitionFormSchema.parse({
    enabled: true,
    title: 'Выдача комплекта',
    sections: [{ kind: 'fields', fields: [issueKey], formulas: { [issueKey]: args.issueFormula } }],
  });
}

/**
 * Правила кнопок демо-маршрута: пустой список условий — «любой, кто может
 * править сущность» (ADR-0020). Демо-мир смотрят и жмут разные учётки
 * (night-набор приёмки и владелец), а роли assignee/creator привязали бы
 * кнопку к одной — критерии 1–3 должны воспроизводиться у любого зрителя.
 */
export function routeRules(): Prisma.InputJsonValue {
  return workflowTransitionRulesSchema.parse({}) as unknown as Prisma.InputJsonValue;
}

/** Пустая форма перехода (окно выключено). */
export function emptyForm(): Prisma.InputJsonValue {
  return transitionFormSchema.parse({
    enabled: false,
    sections: [],
  }) as unknown as Prisma.InputJsonValue;
}
