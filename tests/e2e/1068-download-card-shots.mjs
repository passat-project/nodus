/* global window, document, getComputedStyle */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * Кадры карточки «Файл скачан» после #1068 (вердикт владельца 27.11.2026):
 * размер как у обычной карточки уведомления, строка по центру, крестик —
 * последний элемент строки и на одном уровне во всех состояниях.
 * РЕАЛЬНЫЙ код мини-UI: dist раздаётся перехватом запросов (герметично, без
 * портов), Tauri-IPC — стаб `__TAURI_INTERNALS` (label окна + popup_get_data).
 * Не тест — предпросмотр для владельца; проверки печатают отклонения и
 * завершают скрипт с ошибкой.
 */
const dist = 'apps/desktop/dist';
const out = 'docs/pr-assets/1068';
mkdirSync(out, { recursive: true });
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const download = (name, success, count = 1) => ({ download: { fileName: name, success, count } });
const chat = {
  id: 'msg-1',
  conversationId: 'conv-1',
  title: 'Алина Воронич',
  preview: 'Смета по объекту согласована, посмотрите вложения',
  canReply: true,
};

const cases = [
  { name: 'after-01-single-light.png', theme: 'light', ...download('image.png', true) },
  {
    name: 'after-02-series-light.png',
    theme: 'light',
    ...download('акт-осмотра-44.docx', true, 5),
  },
  { name: 'after-03-failed-light.png', theme: 'light', ...download('чертёж-фасада.dwg', false) },
  {
    name: 'after-04-long-light.png',
    theme: 'light',
    ...download('смета-объект-774-корпус-2-финальная-версия-согласованная.pdf', true),
  },
  { name: 'after-05-single-dark.png', theme: 'dark', ...download('image.png', true) },
  { name: 'after-06-failed-dark.png', theme: 'dark', ...download('чертёж-фасада.dwg', false) },
  { name: 'after-07-chat-light.png', theme: 'light', ...chat },
];

const browser = await chromium.launch();
/** Высота карточки и центры строки/крестика внутри неё — по кадру каждой темы. */
const heights = [];
const closeOffsets = [];
let failures = 0;

for (const { name, theme, ...payload } of cases) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 120 } });
  // Стаб Tauri 2: label окна решает, что мини-UI рендерит попап; invoke
  // отвечает на pull-команды (данные карточки, высота, готовность).
  await ctx.addInitScript(
    (data) => {
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: 'popup-download' },
          currentWebview: { label: 'popup-download' },
        },
        transformCallback: () => 1,
        plugins: {},
        invoke: (cmd) => Promise.resolve(cmd === 'popup_get_data' ? data : null),
      };
    },
    { theme, fadeMs: 3000, autoHideMs: 8000, ...payload },
  );
  await ctx.route('http://mini.local/**', (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname === '/' ? '/index.html' : url.pathname;
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
  // Высота окна = факту контента, формула ТА ЖЕ, что в popup-view и Rust
  // (контент + паддинги + рамка карточки, +1 субпиксельная страховка).
  const { contentH, chrome } = await page.evaluate(() => {
    const root = document.querySelector('div.group');
    const content = document.querySelector('div.group > div');
    const s = getComputedStyle(root);
    const px = [s.paddingTop, s.paddingBottom, s.borderTopWidth, s.borderBottomWidth].reduce(
      (sum, v) => sum + (Number.parseFloat(v) || 0),
      0,
    );
    return { contentH: content.getBoundingClientRect().height, chrome: px };
  });
  const viewportH = Math.ceil(contentH + chrome) + 1;
  await page.setViewportSize({ width: 360, height: viewportH });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}` });

  const metrics = await page.evaluate(() => {
    const center = (el) => {
      const r = el.getBoundingClientRect();
      return Math.round((r.top + r.height / 2) * 10) / 10;
    };
    const root = document.querySelector('div.group');
    const content = document.querySelector('div.group > div');
    const close = document.querySelector('[aria-label="Закрыть"]');
    const folder = document.querySelector('[aria-label="Показать в папке"]');
    return {
      cardH: Math.round(root.getBoundingClientRect().height),
      contentH: Math.round(content.getBoundingClientRect().height),
      closeCy: close ? center(close) : null,
      folderCy: folder ? center(folder) : null,
    };
  });
  const isDownload = 'download' in payload;
  heights.push(metrics.cardH);
  console.log(
    `${name} theme=${theme} cardH=${metrics.cardH} contentH=${metrics.contentH} close.cy=${metrics.closeCy} folder.cy=${metrics.folderCy}`,
  );
  if (isDownload) {
    closeOffsets.push(metrics.closeCy);
    // Крестик — в строке и по центру карточки: половина высоты окна.
    if (Math.abs(metrics.closeCy - metrics.cardH / 2) > 0.6) {
      console.error(
        `  ✗ крестик не по центру карточки: ${metrics.closeCy} != ${metrics.cardH / 2}`,
      );
      failures += 1;
    }
    if (metrics.folderCy !== null && Math.abs(metrics.closeCy - metrics.folderCy) > 0.6) {
      console.error(`  ✗ крестик не на уровне папки: ${metrics.closeCy} != ${metrics.folderCy}`);
      failures += 1;
    }
  }
  await ctx.close();
}
await browser.close();

// Все карточки — одного размера (как обычное уведомление).
const [reference, ...rest] = heights;
if (rest.some((h) => h !== reference)) {
  console.error(`✗ высоты разъехались: ${heights.join(', ')}`);
  failures += 1;
}
// Крестик во всех состояниях скачивания — на одной линии.
if (new Set(closeOffsets).size !== 1) {
  console.error(`✗ уровень крестика разъехался: ${closeOffsets.join(', ')}`);
  failures += 1;
} else {
  console.log(
    `ok: высота всех карточек ${reference}, крестик во всех состояниях на ${closeOffsets[0]}`,
  );
}
process.exitCode = failures === 0 ? 0 : 1;
console.log('done');
