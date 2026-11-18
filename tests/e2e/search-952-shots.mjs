import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

/**
 * Кадры и замеры окна поиска (#952, НЕ тест, в suites не входит): панель
 * фильтров не меняет высоту/не получает скролл при выборе типа, закрытие
 * очищает строку. Обе темы — на живых данных песочницы без моков.
 *
 *   NODUS_BASE_URL=http://127.0.0.1:4173 node search-952-shots.mjs [outDir]
 */
const base = (process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const out = process.argv[2] ?? 'docs/pr-assets/952';
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

const rail = () => page.locator('aside[aria-label="Фильтры поиска"]');
const measure = () =>
  rail().evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    };
  });
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
/** Просвет под последним элементом панели (низ окна минус низ «Сбросить»). */
const bottomGap = () =>
  rail().evaluate((el) => {
    const children = [...el.children];
    const last = children[children.length - 1];
    return Math.round(el.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom);
  });
const openWith = async (query) => {
  await page.keyboard.press('Control+k');
  await search.waitFor({ state: 'visible' });
  await search.locator('[data-slot="command-input"]').fill(query);
  await search.getByRole('option').first().waitFor({ state: 'visible', timeout: 20_000 });
};

const search = page.locator('[data-slot="command"]');
await openWith('проект');

const before = await measure();

// Выбор типа: панель не должна менять высоту и получить скролл.
await rail()
  .getByRole('button', { name: /^Задачи/ })
  .click();
await page.waitForTimeout(600);
const afterType = await measure();
const gapAfterType = await bottomGap();
await shot('rail-filter-light');

// «Сбросить» в шапке секции возвращает «Все типы» без сдвига панели.
await rail().getByRole('button', { name: 'Сбросить фильтры' }).click();
await page.waitForTimeout(600);
const afterReset = await measure();

// Закрытие очищает строку: повторный Ctrl+K — чистое окно.
await page.keyboard.press('Escape');
await search.waitFor({ state: 'hidden' });
await page.keyboard.press('Control+k');
const reopened = page.locator('[data-slot="command-input"]');
await reopened.waitFor({ state: 'visible' });
const reopenedValue = await reopened.inputValue();
await shot('reopen-empty-light');
await page.keyboard.press('Escape');
await search.waitFor({ state: 'hidden' });

// Тёмная тема — то же состояние (выбран тип, «Сбросить» в шапке «Типы»):
// модальное окно закрывает шапку портала, поэтому тема переключается вне него.
await page.getByRole('button', { name: 'Тёмная тема' }).click();
await page.waitForTimeout(400);
await openWith('проект');
await rail()
  .getByRole('button', { name: /^Задачи/ })
  .click();
await page.waitForTimeout(600);
await shot('rail-filter-dark');
await page.keyboard.press('Escape');
await search.waitFor({ state: 'hidden' });
await page.getByRole('button', { name: 'Светлая тема' }).click();
await page.waitForTimeout(300);

const stable =
  before.x === afterType.x &&
  before.width === afterType.width &&
  afterType.clientHeight >= afterType.scrollHeight - 1;
const report = { before, afterType, afterReset, reopenedValue, gapAfterType, stable };
console.log(JSON.stringify(report, null, 2));

await browser.close();
process.exit(stable && reopenedValue === '' ? 0 : 1);
