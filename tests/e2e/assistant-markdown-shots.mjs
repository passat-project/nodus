import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/** Кадры Markdown-ответа ассистента (#897, ADR-0045), НЕ тест: обе темы,
 *  окно целиком и кроп ответа (список, таблица, код).
 *  NODUS_BASE_URL=http://localhost:4173 node assistant-markdown-shots.mjs <outDir> */
const base = (process.env.NODUS_BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const out = process.argv[2] ?? 'assistant-markdown-shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });

await page.goto(`${base}/login`);
await page.getByLabel('Рабочая почта').fill('admin@nodus.by');
await page.getByLabel('Пароль').fill('ci-e2e-admin-2026');
await page.getByRole('button', { name: 'Войти' }).click();
await page.waitForTimeout(3500);
await page.goto(`${base}/tasks`);
await page.waitForTimeout(2500);

const entry = page.getByRole('button', { name: 'ИИ-ассистент (Ctrl+J)' });
await entry.first().waitFor({ state: 'visible', timeout: 30000 });
await entry.first().click();
await page.waitForTimeout(1600);

if (process.env.NODUS_MARKDOWN_SEEDED === '1') {
  // Проверенная ветка без сетевого вызова провайдера: в night-БД уже лежит
  // диалог с Markdown-ответом (окружение с TLS-инспекцией ломает провайдера).
  await page
    .locator('table')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => undefined);
  await page.waitForTimeout(1200);
} else {
  // Чистый диалог: заголовок шапки — вопрос, лента без прошлых реплик.
  await page.getByRole('button', { name: 'Новый диалог' }).click();
  await page.waitForTimeout(700);

  const composer = page.getByPlaceholder('Спросите ассистента…');
  await composer.fill(
    'Ответь строго в Markdown, без пояснений: заголовок «Итоги недели», список из трёх пунктов, одно **жирное** слово, таблица из двух колонок и двух строк, короткий блок кода на JavaScript и ссылку https://example.com',
  );
  await composer.press('Enter');

  // Ждём именно Markdown-разметку ответа (таблица появляется в конце), а не
  // только исчезновение «Остановить»: стриминг рисует текст постепенно.
  await page
    .locator('table')
    .first()
    .waitFor({ state: 'visible', timeout: 120000 })
    .catch(() => undefined);
  await page.waitForTimeout(1500);
}

await shot('markdown-light');

// Кроп ответа: окно ассистента живёт у правого края рамы — берём его полосу
// целиком по высоте ленты (доказательство разметки крупным планом).
await page.screenshot({
  path: `${out}/markdown-light-crop.png`,
  clip: { x: 1014, y: 80, width: 566, height: 760 },
});

await page.getByRole('button', { name: 'Тёмная тема' }).click();
await page.waitForTimeout(700);
await shot('markdown-dark');

await browser.close();
if (errors.length > 0) {
  console.log('console errors:', errors.slice(0, 5));
}
console.log('done', out);
