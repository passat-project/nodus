/* global window, getComputedStyle */
import { chromium } from '@playwright/test';

/**
 * Кадры панели оболочки (#1038) из РЕАЛЬНОГО кода веб-панели: в браузер
 * инжектируется признак оболочки (мост-стаб: любые методы — no-op), коллаут
 * и точка ⟳ — через настоящий детект (version.json замокан на 99.0.0).
 * Ховеры проверяются computed-стилем, геометрия коллаута — прямоугольниками
 * (детерминированно). Не тест — предпросмотр для владельца.
 */
const base = 'http://127.0.0.1:4173';
const out = 'docs/pr-assets/1038';
const OWNER = { email: 'a.klimovich@passatproekt.by', password: 'ci-e2e-demo-2026' };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => {
  window.nodusDesktop = new Proxy(
    { shellVersion: '1.0.22', platform: 'windows' },
    {
      get(t, p) {
        if (p in t) return t[p];
        return () => undefined;
      },
    },
  );
  window.__nodusDesktopInvoke = () => {};
});
const page = await ctx.newPage();
await page.route('**/version.json', (route) => route.fulfill({ json: { version: '99.0.0' } }));
await page.goto(`${base}/login`);
await page.getByLabel('Рабочая почта').fill(OWNER.email);
await page.getByLabel('Пароль').fill(OWNER.password);
await page.getByRole('button', { name: 'Войти' }).click();
await page.waitForURL(/\/home$/, { timeout: 30_000 });
await page.waitForTimeout(2500);

const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
const rect = (loc) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, centerX: r.left + r.width / 2 };
  });
const panel = page.locator('[data-shell-panel]');
await panel.waitFor({ timeout: 10_000 });
await page.screenshot({ path: `${out}/panel-01-light.png` });

// Коллаут: фокус окна триггерит настоящий детект (version.json новее вшитой).
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForTimeout(2500);
const reload = panel.getByRole('button', { name: 'Обновить страницу' });
const plate = page.locator('[data-portal-update-callout]');
const arrow = plate.locator('span[aria-hidden="true"]');
console.log('plate.left =', (await rect(plate)).left, ' reload.left =', (await rect(reload)).left);
console.log(
  'arrow.cx =',
  (await rect(arrow)).centerX,
  ' reload.cx =',
  (await rect(reload)).centerX,
);
// Обводка стрелки обязана совпадать с рамкой плашки (вердикт владельца
// 25.11: «уголок без границы» — дефект).
const arrowBorder = await arrow.evaluate((el) => {
  const s = getComputedStyle(el);
  return `${s.borderTopWidth} ${s.borderTopColor} / ${s.borderLeftWidth} ${s.borderLeftColor}`;
});
console.log('arrow border (t/l) =', arrowBorder);
const ring = await plate.evaluate((el) => {
  const s = getComputedStyle(el);
  return `${s.boxShadow || s.getPropertyValue('--tw-ring-shadow')}`;
});
console.log('plate ring =', ring.slice(0, 90));
await page.screenshot({ path: `${out}/panel-02-callout-light.png` });
await page.screenshot({
  path: `${out}/panel-02b-callout-zoom.png`,
  clip: { x: 0, y: 0, width: 620, height: 130 },
});

await reload.hover();
await page.waitForTimeout(600);
await page.screenshot({
  path: `${out}/panel-03-hover-reload.png`,
  clip: { x: 0, y: 0, width: 620, height: 90 },
});

const downloads = panel.getByRole('button', { name: 'Загрузки' });
await downloads.hover();
await page.waitForTimeout(600);
console.log('downloads bg =', await bg(downloads));
const appRect = await rect(panel.getByRole('button', { name: 'Приложение' }));
const dlRect = await rect(downloads);
console.log(
  'app.right =',
  appRect.right,
  ' downloads.left =',
  dlRect.left,
  ' downloads.right =',
  dlRect.right,
);
await page.screenshot({
  path: `${out}/panel-04-hover-downloads.png`,
  clip: { x: 950, y: 0, width: 650, height: 90 },
});

const close = page.locator('[aria-label="Закрыть окно"]');
await close.hover();
await page.waitForTimeout(600);
console.log('close bg =', await bg(close));
await page.screenshot({
  path: `${out}/panel-05-hover-close-red.png`,
  clip: { x: 1000, y: 0, width: 600, height: 90 },
});

await page.locator('[aria-label="Приложение"]').click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/panel-06-app-window.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

await page.getByRole('button', { name: 'Тёмная тема' }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/panel-07-dark.png` });
await close.hover();
await page.waitForTimeout(600);
console.log('close bg dark =', await bg(close));
await page.screenshot({
  path: `${out}/panel-08-hover-close-red-dark.png`,
  clip: { x: 1000, y: 0, width: 600, height: 90 },
});

await browser.close();
console.log('done');
