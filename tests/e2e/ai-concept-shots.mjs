import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/** Кадры концепта ИИ-ассистента (НЕ тест, в suites не входит): плавающее окно
 *  поверх рамы, обе темы, пикер сессий, новый диалог, мессенджер.
 *   NODUS_BASE_URL=http://localhost:5173 node ai-concept-shots.mjs [outDir] */
const base = (process.env.NODUS_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const out = process.argv[2] ?? 'ai-concept-shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`${base}/tasks`);
if (page.url().includes('/login')) {
  await page.getByLabel('Рабочая почта').fill('demo@passatproekt.by');
  await page.getByLabel('Пароль').fill('demo');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL(/\/tasks/);
}
await page.waitForTimeout(1200);

const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

// 1. Светлая: кнопка агента внизу полосы → сразу прошлый чат поверх рамы.
await page.getByRole('button', { name: 'ИИ-ассистент (Ctrl+J)' }).click();
await page.waitForTimeout(500);
await shot('b-light-dialog');

// 2. Пикер сессий из шапки.
await page.getByRole('button', { name: 'Диалоги ассистента' }).click();
await page.waitForTimeout(400);
await shot('b-light-picker');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 3. Тёмная тема, тот же диалог: окно ниже топбара — тема доступна при
//    открытом окне (вердикт владельца 16.11.2026).
await page.getByRole('button', { name: 'Тёмная тема' }).click();
await page.waitForTimeout(400);
await shot('b-dark-dialog');

// 4. Новый диалог: приветствие и подсказки, тёмная.
await page.getByRole('button', { name: 'Новый диалог' }).click();
await page.waitForTimeout(400);
await shot('b-dark-welcome');

// 5. Вопрос из подсказки → ответ печатается, тёмная.
await page.getByRole('button', { name: 'Что у меня просрочено?' }).click();
await page.waitForTimeout(7000);
await shot('b-dark-live');

// 6. Светлая, окно закрыто — кнопка агента на полосе (.last() = кнопка
//    полосы: крестик окна несёт то же доступное имя).
await page.getByRole('button', { name: 'Закрыть ассистента' }).last().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Светлая тема' }).click();
await page.waitForTimeout(500);
await shot('b-light-closed');

// 7. Мессенджер: полоса скрыта, вход Ctrl+J, окно поверх рамы.
await page.goto(`${base}/chat`);
await page.waitForTimeout(1200);
await page.keyboard.press('Control+j');
await page.waitForTimeout(500);
await shot('b-light-chat');

await browser.close();
console.log('done', out);
