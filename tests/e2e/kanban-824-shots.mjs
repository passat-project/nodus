import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/**
 * Кадры и замеры #824: ширина плитки канбана — динамическая полоса 240–360px,
 * как в Битриксе (min 259 / max 369 по замерам владельца). 1920 — 6 плиток
 * заполняют ряд (≈244), 2560 — шесть тянутся (≈351), 3440 — упираются в 360;
 * на 2560 восемь плиток делят ряд (≈261).
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

  await page.goto(`${base}/login`);
  await page.waitForTimeout(700);
  await page.getByLabel('Рабочая почта').fill('night-a@nodus.local');
  await page.getByLabel('Пароль').fill('Night-Probe-100!');
  const [login] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Войти' }).click(),
  ]);
  const token = (await login.json()).accessToken;
  await page.waitForURL(/\/home/, { timeout: 15000 });
  await page.goto(`${base}/tasks`);
  await page.waitForTimeout(2000);

  async function measure(width, height, shotName) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(700);
    // Окружение страницы — строковой формой: eslint парсит Node-файл и
    // браузерных глобалов (document/window) в нём нет (канон shot-скриптов).
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
    results.push({ theme, shotName, ...m, errors });
    console.log(theme, shotName, JSON.stringify(m));
  }

  await measure(1920, 1080, `01-1920-${theme}`);
  await measure(2560, 1440, `02-2560-${theme}`);
  await measure(3440, 1440, `03-3440-${theme}`);

  // Восемь плиток на 2560: добавляем две личные стадии через живой API
  // (идемпотентность как у клиента), после замеров удаляем.
  const created = [];
  for (const name of ['Демо 824 A', 'Демо 824 B']) {
    const id = await page.evaluate(
      async ([bearer, stageName, key]) => {
        const res = await fetch('/api/v1/tasks/personal-stages', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify({ name: stageName, color: 'info', systemState: 'active' }),
        });
        if (!res.ok) throw new Error(`create ${res.status}: ${await res.text()}`);
        return (await res.json()).id;
      },
      [token, name, randomUUID()],
    );
    created.push(id);
  }
  await page.reload();
  await page.waitForTimeout(2000);
  await measure(2560, 1440, `04-2560-8cols-${theme}`);
  await measure(3440, 1440, `05-3440-8cols-${theme}`);

  for (const id of created) {
    await page.evaluate(
      async ([bearer, stageId, key]) => {
        const res = await fetch(`/api/v1/tasks/personal-stages/${stageId}`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${bearer}`, 'Idempotency-Key': key },
        });
        if (!res.ok) throw new Error(`delete ${res.status}: ${await res.text()}`);
      },
      [token, id, randomUUID()],
    );
  }
  await ctx.close();
}

await browser.close();
console.log('RESULTS', JSON.stringify(results, null, 2));
