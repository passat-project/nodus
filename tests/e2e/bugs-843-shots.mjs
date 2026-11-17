import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Кадры #843 (лёгкие баги, пачка 2): видимые исправления на живой песочнице
 * non-mock — фильтр «Что нового» и счётчик журнала проектов «N+».
 *   NODUS_BASE_URL=http://127.0.0.1:4173 node bugs-843-shots.mjs
 *
 * Остальные пункты пачки — поведение клавиатуры, схемы и данных: кадр их не
 * показывает, доказательство — unit-тесты в PR.
 */
const base = (process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const out =
  process.env.NODUS_SHOTS_DIR ??
  fileURLToPath(new URL('../../docs/pr-assets/843/', import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();

async function newPage(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(
    `localStorage.setItem('nodus-shell-v1', JSON.stringify({ state: { theme: ${JSON.stringify(theme)}, edgeOpen: false }, version: 1 }));`,
  );
  return { ctx, page: await ctx.newPage() };
}

async function login(page) {
  await page.goto(`${base}/login`);
  await page.waitForTimeout(700);
  if (!/\/login/.test(page.url())) return;
  await page.getByLabel('Рабочая почта').fill('night-a@nodus.local');
  await page.getByLabel('Пароль').fill('Night-Probe-100!');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/home/, { timeout: 15000 });
}

for (const theme of ['light', 'dark']) {
  const { ctx, page } = await newPage(theme);
  await login(page);

  // «Что нового»: фильтр по модулю, которого нет в свежем выпуске, — первый
  // показанный выпуск развёрнут, пункты видны.
  await page.getByRole('button', { name: /Что нового/ }).click();
  await page.getByRole('dialog', { name: 'Что нового' }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Корреспонденция' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/01-whats-new-filter-${theme}.png` });

  // Журнал проектов: курсорная пагинация — счётчик «N+» (в песочнице 51 проект).
  await page.goto(`${base}/projects`);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/02-projects-count-${theme}.png` });

  await ctx.close();
}

await browser.close();
console.log('shots', out);
