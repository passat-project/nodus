import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

/**
 * Кадры окна «Архивировать подразделение» (#879, НЕ тест, в suites не входит):
 * текст подтверждения объясняет последствия для ролей — обе темы, живые данные
 * песочницы без моков.
 *
 *   NODUS_BASE_URL=http://127.0.0.1:4173 node archive-879-shots.mjs [outDir]
 */
const base = (process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const out = process.argv[2] ?? 'docs/pr-assets/879';
mkdirSync(out, { recursive: true });

const admin = JSON.parse(readFileSync(new URL('./e2e-users.json', import.meta.url), 'utf8')).admin;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${base}/`);
await page.waitForURL(/\/(home|login)$/, { timeout: 30_000 });
if (page.url().includes('/login')) {
  await page.getByLabel('Рабочая почта').fill(admin.email);
  await page.getByLabel('Пароль').fill(admin.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/home$/, { timeout: 30_000 });
}

/** Лист дерева: карточка без вложенных отделов (в сиде — «Группа BIM-технологий»). */
const LEAF = 'Группа BIM-технологий';
const panel = () => page.locator('[data-structure-side-panel]');

async function openStructure() {
  await page.goto(`${base}/employees?view=structure`);
  await page.locator('[data-tree-node]').first().waitFor({ timeout: 30_000 });
}

async function openArchiveDialog() {
  const card = page.locator('[data-tree-node]', { hasText: LEAF }).first();
  await card.getByRole('button').first().click();
  await panel().waitFor({ state: 'visible' });
  await panel().getByRole('button', { name: 'Действия с подразделением' }).click();
  await page.getByRole('menuitem', { name: 'Архивировать подразделение' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });
  await page.waitForTimeout(300);
  return dialog;
}

await openStructure();
const dialog = await openArchiveDialog();
await page.screenshot({ path: `${out}/archive-dialog-light.png` });
await dialog.getByRole('button', { name: 'Отмена' }).click();
await dialog.waitFor({ state: 'hidden' });

await page.getByRole('button', { name: 'Тёмная тема' }).click();
await page.waitForTimeout(400);
const darkDialog = await openArchiveDialog();
await page.screenshot({ path: `${out}/archive-dialog-dark.png` });
await darkDialog.getByRole('button', { name: 'Отмена' }).click();
await page.waitForTimeout(200);

await page.getByRole('button', { name: 'Светлая тема' }).click();
await browser.close();
console.log(`shots: ${out}/archive-dialog-light.png, ${out}/archive-dialog-dark.png`);
