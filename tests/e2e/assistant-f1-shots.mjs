import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/** Кадры Ф1 ассистента (НЕ тест, в suites не входит): окно с ответом и
 *  вызовами инструментов (обе темы) + реестр «Настройки → ИИ-агент».
 *  NODUS_BASE_URL=http://localhost:4173 node assistant-f1-shots.mjs <outDir> */
const base = (process.env.NODUS_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const out = process.argv[2] ?? 'assistant-f1-shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

await page.goto(`${base}/login`);
await page.getByLabel('Рабочая почта').fill('admin@nodus.by');
await page.getByLabel('Пароль').fill('ci-e2e-admin-2026');
await page.getByRole('button', { name: 'Войти' }).click();
await page.waitForTimeout(3500);
await page.goto(`${base}/tasks`);
await page.waitForTimeout(2500);

// Вход в окно ассистента — кнопка рейки (ждём появления, рейка рисуется
// после загрузки прав/флагов).
const entry = page.getByRole('button', { name: 'ИИ-ассистент (Ctrl+J)' });
await entry.first().waitFor({ state: 'visible', timeout: 30000 });
await entry.first().click();
// Контент монтируется после оседания выезда (210 мс) + fade-in: клик по
// подсказкам раньше времени проваливается в экран за окном.
await page.waitForTimeout(1600);

// Вопрос по реальным данным — через композер (подсказку не трогаем: её
// координаты в анимации выезда ловят клик на экране под окном).
const composer = page.getByPlaceholder('Спросите ассистента…');
await composer.fill('Что у меня просрочено?');
await composer.press('Enter');
await page.waitForTimeout(16000);
await shot('f1-light-answer');

// Тёмная тема того же ответа.
await page.getByRole('button', { name: 'Тёмная тема' }).click();
await page.waitForTimeout(600);
await shot('f1-dark-answer');

// Новый диалог — приветствие (тёмная).
await page.getByRole('button', { name: 'Новый диалог' }).click();
await page.waitForTimeout(500);
await shot('f1-dark-welcome');

// Настройки портала → ИИ-агент: реестр провайдеров (тёмная), затем светлая.
await page.goto(`${base}/settings?tab=ai`);
await page.waitForTimeout(1600);
await shot('f1-dark-settings');
await page.getByRole('button', { name: 'Светлая тема' }).click();
await page.waitForTimeout(600);
await shot('f1-light-settings');

// Окно правки провайдера (светлая).
const row = page.getByRole('row').nth(1);
if (await row.count()) {
  await row.click();
  await page.waitForTimeout(700);
  await shot('f1-light-provider-dialog');
}

await browser.close();
console.log('done', out);
