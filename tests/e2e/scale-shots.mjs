import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Скриншоты для UI-чекпоинта масштаба (issue #60): все ключевые экраны,
 * обе темы, контроль горизонтального переполнения кадра.
 *   NODUS_BASE_URL=http://localhost:5173 node scale-shots.mjs [outDir] [light|dark] [full|min]
 * min — урезанный набор для A/B-прогонов масштаба.
 */
const base = (process.env.NODUS_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const out = process.argv[2] ?? 'shots-scale';
const theme = process.argv[3] ?? 'light';
const mode = process.argv[4] ?? 'full';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
// Браузерные глобалы (localStorage, document) — только ВНУТРИ строковых форм
// addInitScript/evaluate: они выполняются в странице, а eslint парсит Node-файл.
await ctx.addInitScript(
  `localStorage.setItem('nodus-shell-v1', JSON.stringify({ state: { theme: ${JSON.stringify(theme)}, edgeOpen: false }, version: 1 }));`,
);
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
});

async function shot(name, settle = 1200) {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${out}/${name}__${theme}.png` });
  const overflow = await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  );
  console.log(`shot ${name} overflow=${overflow}`);
  if (overflow > 1) errors.push(`OVERFLOW ${name}: +${overflow}px`);
}

async function tryStep(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.log(`SKIP ${label}: ${e.message.split('\n')[0]}`);
    errors.push(`SKIP ${label}: ${e.message.split('\n')[0]}`);
  }
}

// Логин (мок принимает любые креды)
await page.goto(`${base}/`);
if (page.url().includes('/login')) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/login__${theme}.png` });
  await page.getByLabel('Рабочая почта').fill('demo@passatproekt.by');
  await page.getByLabel('Пароль').fill('demo');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/(home)?$/);
}
await page.waitForTimeout(1600);

// Главная
await page.goto(`${base}/home`);
await shot('home');

if (mode === 'full') {
  // Главная 1280×720 — минимальный поддерживаемый вьюпорт
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${base}/home`);
  await shot('home-1280');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${base}/home`);
  await page.waitForTimeout(800);

  // Ридер-слайдер главной
  await tryStep('home-reader', async () => {
    await page.locator('article button').first().click();
    await shot('home-reader', 1000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  });
}

// Задачи: канбан «Мой план» — дефолтный вид модуля
await page.goto(`${base}/tasks`);
await shot('tasks-kanban', 1400);

// Задачи: журнал
await page.goto(`${base}/tasks?view=list`);
await shot('tasks-list', 1400);

// Карточка задачи (action-bar «Завершить/В работу» — цель жалобы)
await tryStep('task-card', async () => {
  await page.locator('[role="row"]').nth(1).locator('span.truncate').first().click();
  await shot('task-card', 1600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
});

if (mode === 'full') {
  // Письма: журнал + карточка
  await page.goto(`${base}/letters`);
  await shot('letters-list');
  await tryStep('letter-card', async () => {
    await page.locator('[role="row"]').nth(1).locator('[role="cell"]').nth(1).click();
    await shot('letter-card', 1600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  });

  // Проекты: журнал + карточка (Гант / Отчёт / Схема)
  await page.goto(`${base}/projects`);
  await shot('projects-list');
  await tryStep('project-card', async () => {
    await page.locator('[role="row"]').nth(1).locator('[role="cell"]').nth(1).click();
    await shot('project-card', 1600);
    await page.getByRole('button', { name: 'Гант' }).click();
    await shot('project-gantt', 1200);
    await page.getByRole('button', { name: 'Отчёт' }).click();
    await shot('project-report', 1200);
    await page.getByRole('button', { name: 'Схема' }).click();
    await shot('project-flow', 1200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  });

  // Сотрудники (#768): дефолт — «Список»; структура — отдельной вкладкой.
  await page.goto(`${base}/employees`);
  await shot('employees-list', 1200);
  await tryStep('employee-card', async () => {
    await page.locator('[role="row"]').nth(1).locator('span.truncate').first().click();
    await shot('employee-card', 1600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  });
  await tryStep('employees-org', async () => {
    await page
      .getByRole('tab', { name: /Структура/ })
      .or(page.getByText('Структура', { exact: true }))
      .first()
      .click();
    await shot('employees-org');
  });
}

// Мессенджер: лента + композер
await page.goto(`${base}/chat`);
await shot('chat');
await tryStep('chat-conversation', async () => {
  await page.locator('[data-no-scrollbar] button').first().click();
  await shot('chat-conversation', 1400);
});
if (mode === 'full') {
  // Канал с тредами → окно треда
  await tryStep('chat-thread', async () => {
    await page.getByText('Обсудить').first().click({ timeout: 3000 });
    await shot('chat-thread', 1400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  });
  // Правая служебная полоса — раскрыта
  await tryStep('rail-expanded', async () => {
    await page.goto(`${base}/home`);
    await page.waitForTimeout(900);
    const chevrons = page.locator('[data-rail-toggle], button[aria-label*="оллег"]');
    if ((await chevrons.count()) > 0) {
      await chevrons.first().click();
    } else {
      // кнопка-шевроны внизу служебной полосы
      await page.locator('aside button').last().click();
    }
    await shot('rail-expanded', 1200);
  });
  // 200%-эквивалент: viewport 960×540 (браузерный зум 200% на 1920)
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto(`${base}/home`);
  await shot('home-zoom200', 1000);
  await page.goto(`${base}/tasks`);
  await shot('tasks-zoom200', 1000);
}

console.log(`\n=== ${theme}/${mode}: ${errors.length} проблем(ы) ===`);
for (const e of errors.slice(0, 20)) console.log(' -', e);
await browser.close();
