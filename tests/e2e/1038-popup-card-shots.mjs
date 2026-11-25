/* global window, document, getComputedStyle */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * Кадры компактной карточки «Файл скачан» (#1038, волна правок владельца
 * 25.11: без аватара, одна строка, иконка папки). РЕАЛЬНЫЙ код попапа
 * мини-UI: dist раздаётся перехватом запросов (герметично, без портов),
 * Tauri-IPC — стаб `__TAURI_INTERNALS` (label попапа + popup_get_data).
 * Не тест — предпросмотр для владельца.
 */
const dist = 'apps/desktop/dist';
const out = 'docs/pr-assets/1038';
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};

const cases = [
  {
    name: 'download-card-01-single.png',
    download: { fileName: 'смета-объект-774.pdf', success: true, count: 1 },
  },
  {
    name: 'download-card-02-series.png',
    download: { fileName: 'акт-осмотра-44.docx', success: true, count: 5 },
  },
  {
    name: 'download-card-03-failed.png',
    download: { fileName: 'чертёж-фасада.dwg', success: false, count: 1 },
  },
];

const browser = await chromium.launch();
for (const { name, download } of cases) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 120 } });
  // Стаб Tauri 2: label окна решает, что мини-UI рендерит попап; invoke
  // отвечает на pull-команды (данные карточки, высота, готовность).
  await ctx.addInitScript(
    (payload) => {
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: 'popup-download' },
          currentWebview: { label: 'popup-download' },
        },
        transformCallback: () => 1,
        plugins: {},
        invoke: (cmd) => Promise.resolve(cmd === 'popup_get_data' ? payload : null).then((v) => v),
      };
    },
    {
      theme: 'light',
      fadeMs: 3000,
      autoHideMs: 8000,
      download,
    },
  );
  await ctx.route('http://mini.local/**', (route) => {
    const url = new URL(route.request().url());
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    let fsPath = join(dist, p);
    if (!existsSync(fsPath)) fsPath = join(dist, 'index.html');
    const ext = fsPath.slice(fsPath.lastIndexOf('.'));
    route.fulfill({
      body: readFileSync(fsPath),
      contentType: MIME[ext] ?? 'application/octet-stream',
    });
  });
  const page = await ctx.newPage();
  await page.goto('http://mini.local/index.html');
  const card = page.locator('div.group');
  await card.waitFor({ timeout: 10_000 });
  // Высота окна = факту контента (как popup_set_height в оболочке): карточка
  // h-screen заполняет окно целиком — снимаем в реальном калибре.
  const contentH = await page.evaluate(() => {
    const el = document.querySelector('div.group > div');
    return el ? el.getBoundingClientRect().height : 24;
  });
  await page.setViewportSize({ width: 420, height: Math.ceil(contentH) + 18 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}` });

  if (download.success) {
    const folder = page.getByRole('button', { name: 'Показать в папке' });
    await folder.hover();
    await page.waitForTimeout(400);
    console.log(
      `${name} folder bg =`,
      await folder.evaluate((el) => getComputedStyle(el).backgroundColor),
    );
  } else {
    console.log(
      `${name}: ошибка — кнопки папки нет:`,
      await page.getByRole('button', { name: 'Показать в папке' }).count(),
    );
  }
  await ctx.close();
}
await browser.close();
console.log('done');
