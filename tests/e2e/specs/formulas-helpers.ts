import { readFileSync } from 'node:fs';

import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Общие шаги e2e формул (#632, пакет 2c): вход, карточка проекта на вкладке
 * «Структура», шестерёнка атрибутных колонок, карточка задачи, ячейка-формула.
 *
 * Данные — `tests/e2e/formula-demo.json` (единый источник с сидом песочницы
 * `apps/api/prisma/seed-formulas.ts`): спека не выдумывает id и ожидаемые
 * значения, а читает их оттуда. Файл не является спекой — Playwright берёт
 * только `*.spec.ts`, поэтому хелпер импортируется, а не запускается.
 */

export interface DemoUser {
  email: string;
  password: string;
}

export interface FormulaDemo {
  project: { id: string; name: string; cipher: string };
  secretProject: { id: string; name: string; cipher: string };
  buildings: Record<'one' | 'two' | 'secret', { id: string; name: string; gp: string }>;
  tasks: Record<
    'komplektA' | 'komplektB' | 'confidential' | 'secret',
    {
      id: string;
      title: string;
      number: number;
      mark: string;
      cipher: string;
      movedCipher?: string;
    }
  >;
  fields: Record<
    'cipher' | 'number' | 'marka' | 'buildingGp' | 'issue' | 'coefficient',
    { id: string; name: string; prefill?: string }
  >;
  typeName: string;
  transitionName: string;
}

export const DEMO: FormulaDemo = JSON.parse(
  readFileSync(new URL('../formula-demo.json', import.meta.url), 'utf8'),
) as FormulaDemo;

/** Живой стек обязателен: спеки бьют по песочнице, не по мокам и не по проду. */
export const LIVE = Boolean(process.env.E2E_LIVE_API);
export const SKIP_LIVE =
  'Пропущено: задай E2E_LIVE_API=1 и NODUS_BASE_URL на песочницу live-stack (non-mock)';

/** Вход тестовым пользователем (поля формы входа — русские подписи). */
export async function login(page: Page, user: DemoUser): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Рабочая почта').fill(user.email);
  await page.getByLabel('Пароль').fill(user.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

/** Карточка проекта, открытая deep-link'ом на первичной вкладке «Структура». */
export async function openProjectStructure(page: Page, projectId: string): Promise<Locator> {
  await page.goto(`/projects?cards=project:${projectId}`);
  const card = page.getByRole('dialog').first();
  await expect(card).toBeVisible();
  await expect(card.getByRole('table', { name: 'Структура' })).toBeVisible({ timeout: 20_000 });
  return card;
}

/** Дерево структуры (таблица) внутри карточки проекта. */
export function structureTable(card: Locator): Locator {
  return card.getByRole('table', { name: 'Структура' });
}

/**
 * Включить атрибутную колонку шестерёнкой вида (В5 #632): группа «Атрибуты»
 * с поиском, пункт — имя атрибута. Меню живёт в портале — кликаем по странице.
 */
export async function enableAttributeColumn(
  page: Page,
  card: Locator,
  name: string,
): Promise<void> {
  await card.getByRole('button', { name: 'Настроить вид' }).click();
  const item = page.getByRole('menuitemcheckbox', { name });
  await expect(item).toBeVisible();
  await item.click();
  await page.keyboard.press('Escape');
  await expect(card.getByRole('columnheader', { name })).toBeVisible();
}

/** Строка дерева по названию записи (задача или папка). */
export function rowByName(card: Locator, name: string): Locator {
  return structureTable(card).getByRole('row').filter({ hasText: name });
}

/** Ячейка колонки строки по id атрибута (`cf.<uuid>`). */
export function cellOf(row: Locator, fieldId: string): Locator {
  return row.locator(`[data-cell-field="cf.${fieldId}"]`);
}

/** Карточка задачи по deep-link'у (`?cards=task:<id>`). */
export async function openTaskCard(page: Page, taskId: string): Promise<Locator> {
  await page.goto(`/projects?cards=task:${taskId}`);
  const card = page.getByRole('dialog').first();
  await expect(card).toBeVisible();
  await expect(card.getByText('Атрибуты').first()).toBeVisible({ timeout: 20_000 });
  return card;
}

/** Ячейка-формула карточки по id атрибута (`data-testid` в formula-cell.tsx). */
export function formulaCell(card: Locator, fieldId: string): Locator {
  return card.locator(`[data-testid="formula-cell"][data-field-id="${fieldId}"]`);
}

/**
 * Вернуть комплект в начальную стадию (кнопка «Вернуть в разработку» в меню
 * «Ещё»): критерий 3 должен воспроизводиться на тех же данных повторно, а
 * окно выдачи живёт на начальной стадии.
 */
export async function ensureInitialStage(page: Page, card: Locator): Promise<void> {
  const more = card.getByRole('button', { name: 'Ещё действия' });
  if ((await more.count()) === 0) return;
  await more.first().click();
  const back = page.getByRole('menuitem', { name: 'Вернуть в разработку' });
  const visible = await back
    .waitFor({ state: 'visible', timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  if (!visible) {
    await page.keyboard.press('Escape');
    return;
  }
  await back.click();
  await expect(card.getByText('В разработке').first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Подтвердить окно превью переноса, если оно появилось (критерий 1:
 * «перенос изменит значения»). Диалог показывается только при непустом диффе
 * и только на путях с превью (DnD/папки) — меню задачи может переносить без
 * него, поэтому ожидание короткое и необязательное.
 */
export async function confirmMovePreview(page: Page, expected?: string): Promise<void> {
  const preview = page.getByRole('dialog').filter({ hasText: 'Перенос изменит значения' });
  const shown = await preview
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return;
  if (expected) await expect(preview).toContainText(expected);
  await preview.getByRole('button', { name: 'Перенести' }).click();
}
