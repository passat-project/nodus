/* global document, window */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

/**
 * Кадры изменённого UI эпика #1038 (браузерная часть) с живой песочницы :4173:
 * меню аватара с «Что нового», плашка «Портал обновился» (строка топбара +
 * временный overlay-вариант для вкусового выбора), личные тосты под линией
 * топбара. Обе темы. Не тест — ручной прогон:
 *   node tests/e2e/1038-shots.mjs
 * Тосты: сообщение пригоняется живым конвейером (.live-stack/push-709.mjs send).
 */
const base = 'http://127.0.0.1:4173';
const out = 'docs/pr-assets/1038';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}

async function login(page, email, password) {
  await page.goto(`${base}/login`);
  await page.getByLabel('Рабочая почта').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/home$/, { timeout: 30_000 });
}

function newPage(dark = false) {
  const ctx = browser.newContext({ viewport: { width: 1440, height: 900 } });
  return ctx.then(async (c) => {
    const p = await c.newPage();
    if (dark) {
      await p.addInitScript(() =>
        localStorage.setItem(
          'nodus-shell-v1',
          JSON.stringify({ state: { theme: 'dark' }, version: 1 }),
        ),
      );
    }
    return p;
  });
}

async function ensureDark(page) {
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark') {
    await page.getByRole('button', { name: 'Тёмная тема' }).click();
    await page.waitForTimeout(300);
  }
}

const OWNER = { email: 'a.klimovich@passatproekt.by', password: 'ci-e2e-demo-2026' };

// 1. Меню аватара с пунктом «Что нового» (точка непросмотренного).
{
  const page = await newPage(false);
  await login(page, OWNER.email, OWNER.password);
  await page.getByRole('button', { name: 'Профиль' }).click();
  await page.getByText('Что нового').first().waitFor({ timeout: 10_000 });
  await shot(page, '01-avatar-menu-whats-new-light');
  await page.keyboard.press('Escape');
  await ensureDark(page);
  await page.getByRole('button', { name: 'Профиль' }).click();
  await page.getByText('Что нового').first().waitFor();
  await shot(page, '02-avatar-menu-whats-new-dark');
  await page.close();
}

// 2. Плашка «Портал обновилась» → «Портал обновился»: строка топбара (дефолт)
//    и overlay-вариант (вкусовой выбор, ?updatePlate=overlay).
{
  const page = await newPage(false);
  await login(page, OWNER.email, OWNER.password);
  await page.getByText('Портал обновился').waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // триггер сверки — фокус
  await page.waitForTimeout(1200);
  await shot(page, '03-update-plate-topbar-light');
  await ensureDark(page);
  await shot(page, '04-update-plate-topbar-dark');
  await page.goto(`${base}/?updatePlate=overlay`);
  await page.getByText('Портал обновился').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await shot(page, '05-update-plate-overlay-light');
  await page.close();
}

// 3. Личные тосты под линией топбара (живое сообщение от night-b).
{
  const page = await newPage(false);
  await login(page, OWNER.email, OWNER.password);
  execFileSync('node', ['.live-stack/push-709.mjs', 'send', 'Кадр 1038: светлая тема'], {
    stdio: 'ignore',
  });
  await page.getByText('Кадр 1038: светлая тема').first().waitFor({ timeout: 20_000 });
  await shot(page, '06-notification-toast-light');
  await page.close();

  const dark = await newPage(true);
  await login(dark, OWNER.email, OWNER.password);
  await ensureDark(dark);
  execFileSync('node', ['.live-stack/push-709.mjs', 'send', 'Кадр 1038: тёмная тема'], {
    stdio: 'ignore',
  });
  await dark.getByText('Кадр 1038: тёмная тема').first().waitFor({ timeout: 20_000 });
  await shot(dark, '07-notification-toast-dark');
  await dark.close();
}

await browser.close();
console.log('done');
