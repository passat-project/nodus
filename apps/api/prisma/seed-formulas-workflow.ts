/**
 * Маршрут «Комплекта» демо-мира формул (#632, пакет 2c): тип процесса + окно
 * выдачи с формулой-подстановкой «Изм.».
 *
 * Два пути, оба детерминированы:
 * - тип с кодом `kit` ещё не создан (свежая песочница — сид идёт до старта
 *   api) → `seed-formulas-route.ts` сеет свой тип с коротким маршрутом;
 * - тип уже есть (его создал системный каталог на прошлом старте — обычная
 *   ситуация на живой песочнице) → НЕ дублируем тип, а достраиваем окно в
 *   существующий маршрут: берём кнопку «Выдать в печать» (код
 *   `to_sent_to_print`), ставим ей форму с формулой и делаем доступной из
 *   любой стадии (`fromStageId = null`) — иначе с начальной стадии кнопки не
 *   видно, а свежие комплекты стоят именно там.
 *
 * Правка маршрута помечается `customizedAt`: каталог «засев один раз»
 * (ADR-0021) после этого не перетирает окно и не архивирует наши кнопки
 * (переход вне каталога ревизии архивируется при пересборке каталога).
 */
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { createRoute } from './seed-formulas-route.js';
import {
  BACK_CODE,
  BACK_NAME,
  buildIssueForm,
  emptyForm,
  PRINT_CODE,
  ROUTE_IDS,
  routeRules,
  TYPE_CODE,
  type KomplektRoute,
  type RouteArgs,
} from './seed-formulas-support.js';

/** Существующий маршрут типа: маршрут схемы + начальная стадия. */
async function existingRoute(prisma: PrismaClient, typeId: string): Promise<KomplektRoute | null> {
  const entry = await prisma.workflowSchemeEntry.findFirst({
    where: { processTypeId: typeId },
    select: { workflowId: true },
  });
  const stage = entry
    ? await prisma.workflowStage.findFirst({
        where: { workflowId: entry.workflowId, isInitial: true, archivedAt: null },
        select: { id: true },
      })
    : null;
  if (!entry || !stage) return null;
  return { typeId, workflowId: entry.workflowId, stageIds: { initial: stage.id } };
}

/**
 * Кнопка возврата «Вернуть в разработку» (меню «Ещё»): без неё повторный
 * прогон приёмки начинается с комплекта, который уже выдан, и окно выдачи
 * нечего показать — критерий 3 должен воспроизводиться на тех же данных.
 */
async function ensureBack(prisma: PrismaClient, route: KomplektRoute): Promise<void> {
  const existing = await prisma.workflowTransition.findFirst({
    where: { workflowId: route.workflowId, code: BACK_CODE },
    select: { id: true },
  });
  if (existing) return;
  const from =
    (await prisma.workflowStage.findFirst({
      where: { workflowId: route.workflowId, archivedAt: null, code: 'sent_to_print' },
      select: { id: true },
    })) ??
    (await prisma.workflowStage.findFirst({
      where: {
        workflowId: route.workflowId,
        archivedAt: null,
        id: { not: route.stageIds.initial },
      },
      orderBy: [{ sortOrder: 'asc' }],
      select: { id: true },
    }));
  if (!from) return;
  await prisma.workflowTransition.create({
    data: {
      id: ROUTE_IDS.transitionBack,
      workflowId: route.workflowId,
      code: BACK_CODE,
      name: BACK_NAME,
      fromStageId: from.id,
      toStageId: route.stageIds.initial,
      display: 'menu',
      intent: 'action',
      sortOrder: 91,
      rules: routeRules(),
      form: emptyForm(),
    },
  });
}

/** Достройка окна в существующий маршрут (тип от системного каталога). */
async function ensureWindow(
  prisma: PrismaClient,
  route: KomplektRoute,
  args: RouteArgs,
): Promise<void> {
  const transition = await prisma.workflowTransition.findFirst({
    where: {
      workflowId: route.workflowId,
      archivedAt: null,
      OR: [{ name: args.transitionName }, { code: PRINT_CODE }],
    },
    orderBy: [{ sortOrder: 'asc' }],
    select: { id: true },
  });
  if (transition) {
    await prisma.workflowTransition.update({
      where: { id: transition.id },
      data: {
        name: args.transitionName,
        // Из любой стадии: свежий комплект стоит на начальной, кнопка должна
        // быть видна сразу (иначе критерий 3 не воспроизводится на демо-данных).
        fromStageId: null,
        // Вторая залитая кнопка не рисуется (главная одна — groupByDisplay),
        // поэтому у чужого маршрута выдача становится видимой вторичной.
        display: 'button',
        // Демо-маршрут принадлежит сиду: правила и окно приводятся к общему
        // источнику (`formula-demo.json`) на каждом прогоне — иначе правка
        // владельца сделала бы приёмку невоспроизводимой.
        rules: routeRules(),
        form: buildIssueForm(args) as unknown as Prisma.InputJsonValue,
      },
    });
  } else {
    const target = await prisma.workflowStage.findFirst({
      where: {
        workflowId: route.workflowId,
        archivedAt: null,
        id: { not: route.stageIds.initial },
      },
      orderBy: [{ sortOrder: 'asc' }],
      select: { id: true },
    });
    if (!target) return;
    await prisma.workflowTransition.create({
      data: {
        id: ROUTE_IDS.transitionPrint,
        workflowId: route.workflowId,
        code: PRINT_CODE,
        name: args.transitionName,
        fromStageId: route.stageIds.initial,
        toStageId: target.id,
        display: 'primary',
        intent: 'action',
        sortOrder: 90,
        rules: routeRules(),
        form: buildIssueForm(args) as unknown as Prisma.InputJsonValue,
      },
    });
  }
  await ensureBack(prisma, route);
  // Маршрут правился сидом: каталог «засев один раз» больше его не трогает.
  await prisma.workflow.update({
    where: { id: route.workflowId },
    data: { customizedAt: new Date() },
  });
}

/**
 * Тип «Комплект» с окном «Изм.»: свой маршрут или достройка существующего.
 * null — тип есть, но без маршрута (сеять задачи некуда) — мир пропускается.
 */
export async function seedKomplektRoute(
  prisma: PrismaClient,
  args: RouteArgs,
): Promise<KomplektRoute | null> {
  const existing = await prisma.processType.findUnique({
    where: { code: TYPE_CODE },
    select: { id: true, name: true },
  });
  if (!existing) return createRoute(prisma, args);
  const route = await existingRoute(prisma, existing.id);
  if (!route) {
    console.warn(`Формулы #632: тип «${existing.name}» без маршрута — демо-мир пропущен`);
    return null;
  }
  await ensureWindow(prisma, route, args);
  return route;
}
