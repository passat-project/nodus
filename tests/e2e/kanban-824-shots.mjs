import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Кадры и замеры #824: ширина плитки канбана фиксирована под 6 на Full HD
 * и НЕ растягивается на широком мониторе.
 *   NODUS_BASE_URL=http://127.0.0.1:4173 node kanban-824-shots.mjs
 */
const base = (process.env.NODUS_BASE_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const out = process.env.NODUS_SHOTS_DIR ?? 'docs/pr-assets/824';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const results = [];

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(
    `localStorage.setItem('nodus-shell-v1', JSON.stringify({ state: { theme: ${JSON.stringify(theme)}, edgeOpen: false }, version: 1 }));`,
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
  });

  await page.goto(`${base}/login`);
  await page.waitForTimeout(700);
  await page.getByLabel('Рабочая почта').fill('night-a@nodus.local');
  await page.getByLabel('Пароль').fill('Night-Probe-100!');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/home/, { timeout: 15000 });
  await page.goto(`${base}/tasks`);
  await page.waitForTimeout(2500);

  async function measure(width, height, shotName) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(700);
    // Окружение страницы — строковой формой: eslint парсит Node-файл и
    // браузерных галобов (document/window) в нём нет (канон shot-скриптов).
    const m = await page.evaluate(`(() => {
      const scroller = document.querySelector('[data-board-scroller]');
      const tiles = [...scroller.children].map((el) => ({
        tag: el.tagName,
        label: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 20),
        width: Math.round(el.getBoundingClientRect().width * 100) / 100,
        left: Math.round(el.getBoundingClientRect().left),
        right: Math.round(el.getBoundingClientRect().right),
      }));
      const rect = scroller.getBoundingClientRect();
      return {
        viewport: window.innerWidth + 'x' + window.innerHeight,
        scroller: {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          clientWidth: scroller.clientWidth,
          scrollWidth: scroller.scrollWidth,
        },
        tiles,
      };
    })()`);
    await page.screenshot({ path: `${out}/${shotName}.png` });
    results.push({ theme, ...m, errors });
    console.log(theme, shotName, JSON.stringify(m));
  }

  await measure(1920, 1080, `01-1920-${theme}`);
  await measure(2560, 1440, `02-2560-${theme}`);
  await ctx.close();
}

await browser.close();
console.log('RESULTS', JSON.stringify(results, null, 2));
