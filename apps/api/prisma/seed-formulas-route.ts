/**
 * Свой маршрут «Комплекта» для свежей песочницы (#632, пакет 2c): тип
 * процесса, три стадии («В разработке → Выдано в печать → Завершено»), окно
 * выдачи на первом шаге и кнопка возврата в меню «Ещё».
 *
 * Ветка работает, когда тип с кодом `kit` ещё не создан — обычный случай
 * свежей песочницы: `pnpm live-stack up` сеет БД ДО старта api, поэтому
 * системный каталог «Процессов» (ADR-0021) наш тип уже не создаёт (находит
 * по коду и видит `customizedAt`).
 */
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import {
  BACK_CODE,
  BACK_NAME,
  buildIssueForm,
  CATALOG_REVISION,
  emptyForm,
  ROUTE_IDS,
  routeRules,
  TYPE_CODE,
  WORKFLOW_CODE,
  type KomplektRoute,
  type RouteArgs,
} from './seed-formulas-support.js';

/** Тип + маршрут + стадии + переходы демо-мира «Комплекта». */
export async function createRoute(prisma: PrismaClient, args: RouteArgs): Promise<KomplektRoute> {
  const now = new Date();
  const scheme = await prisma.workflowScheme.upsert({
    where: { code: 'default' },
    update: {},
    create: { code: 'default', name: 'Схема по умолчанию', isDefault: true },
  });
  await prisma.processType.create({
    data: {
      id: ROUTE_IDS.type,
      code: TYPE_CODE,
      name: args.typeName,
      category: 'task',
      icon: 'file-text',
      color: 'info',
      description: 'Маршрут комплектации документа: разработка — выдача',
      sortOrder: 2,
      // Правился сидом: каталог «засев один раз» не перетирает (ADR-0021).
      customizedAt: now,
      catalogRevision: CATALOG_REVISION,
    },
  });
  await prisma.workflow.create({
    data: {
      id: ROUTE_IDS.workflow,
      code: WORKFLOW_CODE,
      name: args.typeName,
      kind: 'task',
      isSystem: false,
      version: 1,
      publishedAt: now,
      publishedById: args.adminId,
      customizedAt: now,
      catalogRevision: CATALOG_REVISION,
    },
  });
  await prisma.workflowSchemeEntry.create({
    data: { schemeId: scheme.id, processTypeId: ROUTE_IDS.type, workflowId: ROUTE_IDS.workflow },
  });
  await prisma.workflowStage.createMany({
    data: [
      {
        id: ROUTE_IDS.stageDevelopment,
        workflowId: ROUTE_IDS.workflow,
        code: 'in_development',
        name: 'В разработке',
        color: 'neutral',
        sortOrder: 0,
        systemState: 'backlog',
        isInitial: true,
      },
      {
        id: ROUTE_IDS.stagePrint,
        workflowId: ROUTE_IDS.workflow,
        code: 'sent_to_print',
        name: 'Выдано в печать',
        color: 'info',
        sortOrder: 1,
        systemState: 'active',
      },
      {
        id: ROUTE_IDS.stageFinished,
        workflowId: ROUTE_IDS.workflow,
        code: 'finished',
        name: 'Завершено',
        color: 'success',
        sortOrder: 2,
        systemState: 'closed',
        outcome: 'success',
      },
    ],
  });
  await prisma.workflowTransition.createMany({
    data: [
      {
        id: ROUTE_IDS.transitionPrint,
        workflowId: ROUTE_IDS.workflow,
        code: 'to_sent_to_print',
        name: args.transitionName,
        fromStageId: ROUTE_IDS.stageDevelopment,
        toStageId: ROUTE_IDS.stagePrint,
        display: 'primary',
        intent: 'action',
        sortOrder: 0,
        rules: routeRules(),
        form: buildIssueForm(args) as unknown as Prisma.InputJsonValue,
      },
      {
        id: ROUTE_IDS.transitionFinish,
        workflowId: ROUTE_IDS.workflow,
        code: 'to_finished',
        name: 'Завершить',
        fromStageId: ROUTE_IDS.stagePrint,
        toStageId: ROUTE_IDS.stageFinished,
        display: 'primary',
        intent: 'action',
        sortOrder: 1,
        rules: routeRules(),
        form: emptyForm(),
      },
      {
        id: ROUTE_IDS.transitionBack,
        workflowId: ROUTE_IDS.workflow,
        code: BACK_CODE,
        name: BACK_NAME,
        fromStageId: ROUTE_IDS.stagePrint,
        toStageId: ROUTE_IDS.stageDevelopment,
        display: 'menu',
        intent: 'action',
        sortOrder: 2,
        rules: routeRules(),
        form: emptyForm(),
      },
    ],
  });
  return {
    typeId: ROUTE_IDS.type,
    workflowId: ROUTE_IDS.workflow,
    stageIds: { initial: ROUTE_IDS.stageDevelopment },
  };
}
