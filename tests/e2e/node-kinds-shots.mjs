import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Кадры UI-чекпоинта #556 («Виды папок»): группа и панель вида, окно
 * «Создать папку», панель «Свойства папки», «Атрибуты → Папки». Обе темы.
 *   NODUS_BASE_URL=http://localhost:5173 node node-kinds-shots.mjs [outDir]
 * Мок-мир (`VITE_API_MOCK=true`): посевной «Комплект» и папка «ОВ1.1».
 */
const base = (process.env.NODUS_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const out = process.argv[2] ?? 'shots-556';
mkdirSync(out, { recursive: true });

const PROJECT = '40000000-0000-4000-8000-000000000004';
const KOMPLEKT = '33333333-3333-4333-8333-333333333307';

const browser = await chromium.launch();
const errors = [];

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(
    `localStorage.setItem('nodus-shell-v1', JSON.stringify({ state: { theme: ${JSON.stringify(theme)}, edgeOpen: false }, version: 1 }));`,
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${theme} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${theme} console: ${m.text().slice(0, 200)}`);
  });

  async function shot(name, settle = 900) {
    await page.waitForTimeout(settle);
    await page.screenshot({ path: `${out}/${name}__${theme}.png` });
    const overflow = await page.evaluate(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    );
    if (overflow > 1) errors.push(`${theme} OVERFLOW ${name}: +${overflow}px`);
  }

  await page.goto(`${base}/`);
  if (page.url().includes('/login')) {
    await page.getByLabel('Рабочая почта').fill('demo@passatproekt.by');
    await page.getByLabel('Пароль').fill('demo');
    await page.getByRole('button', { name: 'Войти' }).click();
    await page.waitForURL(/\/(home)?$/);
  }
  await page.waitForTimeout(1400);

  // 1. Группа «Виды папок» + панель «Комплект».
  await page.goto(`${base}/automation?tab=project-types&kind=${KOMPLEKT}`);
  await shot('01-kind-panel');

  // 2. Раздел «При создании папки».
  await page.getByRole('button', { name: /При создании папки/ }).click();
  await shot('02-kind-form');

  // 3. Раздел «Возможности» (из раздела формы — «назад»).
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.getByRole('button', { name: /Возможности/ }).click();
  await shot('03-kind-capabilities');

  // 4. «Атрибуты → Папки».
  await page.goto(`${base}/automation?tab=fields&scope=node`);
  await shot('04-fields-node');

  // 5. Структура проекта: панель «Свойства папки» у «ОВ1.1».
  await page.goto(`${base}/projects?cards=project:${PROJECT}`);
  await page.waitForTimeout(1600);
  await page.getByRole('tab', { name: 'Структура' }).click();
  await page.waitForTimeout(1600);
  const row = page.getByText('ОВ1.1', { exact: true }).first();
  if (await row.count()) {
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Свойства' }).click();
    await shot('05-node-properties');
  } else {
    errors.push(`${theme} SKIP: строка «ОВ1.1» не найдена в структуре`);
  }

  // 6. Окно «Создать папку» с видом «Комплект».
  await page.getByRole('button', { name: 'Создать папку' }).first().click();
  await shot('06-node-create');
  await page.getByRole('button', { name: 'Отмена' }).click();

  await ctx.close();
}

await browser.close();
console.log(errors.length > 0 ? errors.join('\n') : 'OK: кадры сняты без ошибок');
process.exitCode = errors.length > 0 ? 1 : 0;
