import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/** Кадры #902 (НЕ тест): разделы «ИИ-агент» — Провайдеры/Навыки/MCP,
 *  выпадающий список разделов, реестр MCP и окно создания, обе темы.
 *  NODUS_BASE_URL=http://localhost:4173 node ai-settings-sections-shots.mjs <outDir> */
const base = (process.env.NODUS_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const out = process.argv[2] ?? 'ai-settings-sections-shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

await page.goto(`${base}/login`);
await page.getByLabel('Рабочая почта').fill('admin@nodus.by');
await page.getByLabel('Пароль').fill('ci-e2e-admin-2026');
await page.getByRole('button', { name: 'Войти' }).click();
await page.waitForTimeout(3500);

// 1. Провайдеры (светлая по умолчанию).
await page.goto(`${base}/settings?tab=ai`);
await page.waitForTimeout(1500);
await shot('s-light-providers');

// 2. Выпадающий список разделов открыт.
await page.getByLabel('Раздел').click();
await page.waitForTimeout(400);
await shot('s-light-sections-open');
await page.getByRole('option', { name: 'MCP' }).click();
await page.waitForTimeout(1200);
await shot('s-light-mcp');

// 3. Окно создания MCP-сервера (пресет Exa строками).
await page.getByRole('button', { name: 'Создать' }).first().click();
await page.waitForTimeout(600);
await shot('s-light-mcp-dialog');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 4. Тёмная тема: реестр MCP.
await page.getByRole('button', { name: 'Тёмная тема' }).click();
await page.waitForTimeout(600);
await shot('s-dark-mcp');

// 5. Навыки — пустое состояние (тёмная), затем светлая.
await page.goto(`${base}/settings?tab=ai&section=skills`);
await page.waitForTimeout(1400);
await shot('s-dark-skills');
await page.getByRole('button', { name: 'Светлая тема' }).click();
await page.waitForTimeout(600);
await shot('s-light-skills');

await browser.close();
console.log('done', out);
