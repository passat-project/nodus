/**
 * Демо-мир формул ячеек (#632, пакет 2c) — ПЕСОЧНИЦА (`nodus_night`), не прод.
 *
 * Мир повторяет принятый владельцем UI-чекпоинт (моки `formula-demo-*`):
 * тип задачи «Комплект» с формулой шифра `{Проект · Шифр}-{Здание · № по ГП}-
 * {Марка}{Номер}`, вид папки «Здание» с атрибутом «№ по ГП», два здания с
 * комплектами (перенос между ними меняет шифр), окно перехода с
 * формулой-подстановкой «Изм.», конфиденциальный комплект и секретный проект
 * (критерий 5 — утечек нет), ячейка с ошибкой (критерий 4).
 *
 * Данные пишутся штатными моделями Prisma (как остальной сид): значение
 * атрибута — JSONB `custom_fields` по id определения, формула — `default_formula`
 * привязки. AST проверяется контрактом (`assertFormula`): сид падает, если язык
 * формул разошёлся с данными, а не кладёт в БД мусор.
 *
 * Включается только в песочной БД или явным `SEED_FORMULA_DEMO=1`: демо-задачи
 * и секретный проект в проде не нужны (данные песочницы — night-контур).
 */
import type { CustomFieldType, FormulaNode } from '@nodus/contracts';
import { SYSTEM_FIELD_IDS } from '@nodus/contracts';
import type { FormulaFieldMeta } from '@nodus/formula-engine';

import type { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import {
  addKindSlot,
  assertFormula,
  bind,
  cipherFormula,
  DEMO,
  ensureDefinition,
  formulaDemoEnabled,
  issueFormula,
  type FormulaDemo,
} from './seed-formulas-support.js';
import { seedKomplektRoute } from './seed-formulas-workflow.js';

/** Атрибуты мира: тип, подсказка, порядок в реестре (id — из общего JSON). */
const ATTRIBUTES = [
  {
    key: 'cipher',
    type: 'text',
    hint: 'Считается формулой типа: шифр проекта — № по ГП здания — марка и номер',
    sortOrder: 10,
  },
  { key: 'number', type: 'number', hint: 'Порядковый номер в папке', sortOrder: 11 },
  { key: 'buildingGp', type: 'text', hint: 'Номер здания по генеральному плану', sortOrder: 12 },
  {
    key: 'issue',
    type: 'text',
    hint: 'Изменение на момент выдачи — подставляется формулой окна',
    sortOrder: 13,
  },
  {
    key: 'coefficient',
    type: 'number',
    hint: 'Демо ошибки формулы: деление на ноль',
    sortOrder: 14,
  },
] as const satisfies readonly {
  key: keyof FormulaDemo['fields'];
  type: CustomFieldType;
  hint: string;
  sortOrder: number;
}[];

export async function seedFormulaWorld(
  prisma: PrismaClient,
  databaseUrl: string | undefined,
): Promise<void> {
  if (!formulaDemoEnabled(databaseUrl)) {
    console.log('Формулы #632: демо-мир не сеется (не песочница; явно — SEED_FORMULA_DEMO=1)');
    return;
  }
  const admin = await prisma.user.findFirst({
    where: { email: 'admin@nodus.by' },
    select: { id: true },
  });
  const buildingKind = await prisma.nodeKind.findFirst({
    where: { name: 'Здание по генплану' },
    select: { id: true },
  });
  const projectType = await prisma.projectType.findFirst({
    where: { name: 'Договор' },
    select: { id: true },
  });
  const marka = await prisma.fieldDefinition.findUnique({
    where: { id: DEMO.fields.marka.id },
    select: { id: true, number: true, type: true },
  });
  const projectCode = await prisma.fieldDefinition.findUnique({
    where: { id: SYSTEM_FIELD_IDS.projectCode },
    select: { id: true, number: true, type: true },
  });
  if (!admin || !buildingKind || !projectType || !marka || !projectCode) {
    console.warn(
      'Формулы #632: демо-мир пропущен — нет admin@nodus.by, вида «Здание по генплану», ' +
        'типа «Договор», атрибутов «Марка»/«Шифр» (сид гоняется после миграций)',
    );
    return;
  }

  const fields: Partial<
    Record<(typeof ATTRIBUTES)[number]['key'], { id: string; number: number }>
  > = {};
  for (const attribute of ATTRIBUTES) {
    fields[attribute.key] = await ensureDefinition(prisma, {
      id: DEMO.fields[attribute.key].id,
      name: DEMO.fields[attribute.key].name,
      type: attribute.type,
      hint: attribute.hint,
      sortOrder: attribute.sortOrder,
    });
  }
  const cipher = fields.cipher!;
  const komplektNumber = fields.number!;
  const buildingGp = fields.buildingGp!;
  const issue = fields.issue!;
  const coefficient = fields.coefficient!;

  const numbers = {
    projectCode: projectCode.number,
    buildingGp: buildingGp.number,
    marka: marka.number,
    komplektNumber: komplektNumber.number,
    kindId: buildingKind.id,
  };
  const meta = new Map<number, FormulaFieldMeta>([
    [projectCode.number, { number: projectCode.number, type: projectCode.type as CustomFieldType }],
    [marka.number, { number: marka.number, type: marka.type as CustomFieldType }],
    [buildingGp.number, { number: buildingGp.number, type: 'text' }],
    [komplektNumber.number, { number: komplektNumber.number, type: 'number' }],
  ]);
  const cipherAst = cipherFormula(numbers);
  const issueAst = issueFormula(numbers);
  assertFormula(cipherAst, meta, 'text', true);
  assertFormula(issueAst, meta, 'text', false);

  const route = await seedKomplektRoute(prisma, {
    adminId: admin.id,
    typeName: DEMO.typeName,
    transitionName: DEMO.transitionName,
    issueFieldId: issue.id,
    issueFormula: issueAst,
  });
  if (!route) return;

  await bind(prisma, komplektNumber.id, 'process_type', route.typeId);
  await bind(prisma, cipher.id, 'process_type', route.typeId, cipherAst);
  await bind(prisma, marka.id, 'process_type', route.typeId);
  await bind(prisma, issue.id, 'process_type', route.typeId);
  await bind(prisma, coefficient.id, 'process_type', route.typeId);
  await bind(prisma, buildingGp.id, 'node_kind', buildingKind.id);
  await addKindSlot(prisma, buildingKind.id, buildingGp.id);

  const markItems = await prisma.dictionaryItem.findMany({
    where: { dictionary: { code: 'set-mark' }, code: { in: ['КЖ', 'КМ', 'АР'] } },
    select: { id: true, code: true },
  });

  for (const project of [
    { ...DEMO.project, visibility: 'open' as const },
    { ...DEMO.secretProject, visibility: 'secret' as const },
  ]) {
    await prisma.project.upsert({
      where: { id: project.id },
      update: {},
      create: {
        id: project.id,
        name: project.name,
        typeId: projectType.id,
        managerId: admin.id,
        creatorId: admin.id,
        visibility: project.visibility,
        customFields: { [SYSTEM_FIELD_IDS.projectCode]: project.cipher },
      },
    });
    // Участие руководителя (проекция Р2): без строки секретный проект не
    // попадает в журнал даже его руководителю — видимость идёт по участию.
    await prisma.projectParticipant.createMany({
      data: [{ projectId: project.id, userId: admin.id, source: 'manager' }],
      skipDuplicates: true,
    });
  }

  const buildings = [
    { ...DEMO.buildings.one, projectId: DEMO.project.id },
    { ...DEMO.buildings.two, projectId: DEMO.project.id },
    { ...DEMO.buildings.secret, projectId: DEMO.secretProject.id },
  ];
  for (const [index, building] of buildings.entries()) {
    await prisma.projectNode.upsert({
      where: { id: building.id },
      update: {},
      create: {
        id: building.id,
        projectId: building.projectId,
        kindId: buildingKind.id,
        name: building.name,
        order: `a${index}`,
        customFields: { [buildingGp.id]: building.gp },
      },
    });
  }

  const tasks = [
    {
      ...DEMO.tasks.komplektA,
      projectId: DEMO.project.id,
      nodeId: DEMO.buildings.one.id,
      confidential: false,
    },
    {
      ...DEMO.tasks.komplektB,
      projectId: DEMO.project.id,
      nodeId: DEMO.buildings.two.id,
      confidential: false,
    },
    {
      ...DEMO.tasks.confidential,
      projectId: DEMO.project.id,
      nodeId: DEMO.buildings.one.id,
      confidential: true,
    },
    {
      ...DEMO.tasks.secret,
      projectId: DEMO.secretProject.id,
      nodeId: DEMO.buildings.secret.id,
      confidential: false,
    },
  ];
  for (const [index, task] of tasks.entries()) {
    const markId = markItems.find((item) => item.code === task.mark)?.id;
    if (!markId) continue;
    await prisma.task.upsert({
      where: { id: task.id },
      update: {},
      create: {
        id: task.id,
        title: task.title,
        typeId: route.typeId,
        workflowId: route.workflowId,
        stageId: route.stageIds.initial,
        systemState: 'backlog',
        stageOrder: `a${index}`,
        priority: 'normal',
        creatorId: admin.id,
        assigneeId: admin.id,
        projectId: task.projectId,
        nodeId: task.nodeId,
        confidential: task.confidential,
        customFields: { [komplektNumber.id]: task.number, [marka.id]: markId },
      },
    });
  }

  // Демо ошибки ячейки (критерий 4): своя формула `=1/0` у одного комплекта —
  // в карточке «!» с подсказкой, работа с карточкой не блокируется.
  const zeroDivision: FormulaNode = {
    kind: 'op',
    op: 'div',
    args: [
      { kind: 'literal', value: 1 },
      { kind: 'literal', value: 0 },
    ],
  };
  assertFormula(zeroDivision, meta, 'number', false);
  await prisma.formulaCell.upsert({
    where: {
      hostKind_hostId_fieldId: {
        hostKind: 'task',
        hostId: DEMO.tasks.komplektB.id,
        fieldId: coefficient.id,
      },
    },
    update: {},
    create: {
      hostKind: 'task',
      hostId: DEMO.tasks.komplektB.id,
      fieldId: coefficient.id,
      ast: zeroDivision as unknown as Prisma.InputJsonValue,
      error: { code: 'division_by_zero', message: 'Деление на ноль' },
      createdById: admin.id,
    },
  });

  console.log(
    'Формулы #632: демо-мир песочницы — «Комплект» с формулой шифра, здания 1/2, ' +
      'окно «Изм.», конфиденциальный комплект и секретный проект',
  );
}
