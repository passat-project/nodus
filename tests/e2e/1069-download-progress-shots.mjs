/* global window, document, getComputedStyle */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

/**
 * Кадры состояния загрузки карточки «Файл скачан» (#1069): «Скачивается» с
 * полоской прогресса, затем существующая карточка. РЕАЛЬНЫЙ код мини-UI:
 * dist раздаётся перехватом запросов (герметично, без портов), Tauri-IPC —
 * стаб `__TAURI_INTERNALS` (label окна + popup_get_data). Не тест —
 * предпросмотр для владельца; проверки печатают отклонения и завершают
 * скрипт с ошибкой.
 */
const dist = 'apps/desktop/dist';
const out = 'docs/pr-assets/1069';
mkdirSync(out, { recursive: true });
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const download = (name, extra = {}) => ({
  download: { fileName: name, success: true, count: 1, ...extra },
});

const cases = [
  {
    name: 'download-01-progress-light.png',
    theme: 'light',
    ...download('смета-объект-774.pdf', { state: 'downloading', progress: 42 }),
  },
  {
    name: 'download-02-progress-unknown-light.png',
    theme: 'light',
    ...download('видео-осмотра-объекта.mp4', { state: 'downloading' }),
  },
  {
    name: 'download-03-done-light.png',
    theme: 'light',
    ...download('смета-объект-774.pdf', { state: 'done' }),
  },
  {
    name: 'download-04-failed-light.png',
    theme: 'light',
    download: { fileName: 'чертёж-фасада.dwg', success: false, count: 1, state: 'done' },
  },
  {
    name: 'download-05-progress-dark.png',
    theme: 'dark',
    ...download('смета-объект-774.pdf', { state: 'downloading', progress: 42 }),
  },
  {
    name: 'download-06-progress-unknown-dark.png',
    theme: 'dark',
    ...download('видео-осмотра-объекта.mp4', { state: 'downloading' }),
  },
  {
    name: 'download-07-progress-reduced-light.png',
    theme: 'light',
    reducedMotion: 'reduce',
    ...download('видео-осмотра-объекта.mp4', { state: 'downloading' }),
  },
];

const browser = await chromium.launch();
const heights = [];
const closeLevels = [];
let failures = 0;

for (const { name, theme, reducedMotion, ...payload } of cases) {
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 120 },
    reducedMotion: reducedMotion ?? 'no-preference',
  });
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
  await page.locator('div.group').waitFor({ timeout: 10_000 });
  // Шрифт и layout — как в реальном измерении мини-UI (popup-view ждёт
  // document.fonts.ready): иначе min-h строки можно замерить до готовности.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(50);
  // Высота окна = факту контента, формула ТА ЖЕ, что в popup-view и Rust.
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
  const downloading = payload.download.state === 'downloading';
  // Бегущая полоска — кадр анимации произвольный; для стабильного снимка
  // ставим её на фиксированную фазу (имя анимации при этом не меняется).
  if (downloading && payload.download.progress === undefined) {
    await page.addStyleTag({
      content:
        '[data-download-progress] > * { animation-delay: -0.3s !important; animation-play-state: paused !important; }',
    });
    await page.waitForTimeout(50);
  }
  await page.screenshot({ path: `${out}/${name}` });

  const metrics = await page.evaluate(() => {
    const center = (el) => {
      const r = el.getBoundingClientRect();
      return Math.round((r.top + r.height / 2) * 10) / 10;
    };
    const root = document.querySelector('div.group');
    const close = document.querySelector('[aria-label="Закрыть"]');
    const folder = document.querySelector('[aria-label="Показать в папке"]');
    const bar = root.querySelector('[data-download-progress]');
    const fill = bar?.firstElementChild ?? null;
    return {
      cardH: Math.round(root.getBoundingClientRect().height),
      closeCy: close ? center(close) : null,
      folderCy: folder ? center(folder) : null,
      hasBar: Boolean(bar),
      fillRatio:
        bar && fill
          ? Math.round(
              (fill.getBoundingClientRect().width / bar.getBoundingClientRect().width) * 100,
            )
          : null,
      animation: fill ? getComputedStyle(fill).animationName : null,
      text: root.textContent,
    };
  });
  heights.push(metrics.cardH);
  closeLevels.push(metrics.closeCy);
  console.log(
    `${name} theme=${theme} cardH=${metrics.cardH} close.cy=${metrics.closeCy} folder.cy=${metrics.folderCy} bar=${metrics.hasBar} fill=${metrics.fillRatio}% anim=${metrics.animation}`,
  );
  if (Math.abs(metrics.closeCy - metrics.cardH / 2) > 0.6) {
    console.error(`  ✗ крестик не по центру карточки: ${metrics.closeCy} != ${metrics.cardH / 2}`);
    failures += 1;
  }
  const expectsBar = downloading;
  if (metrics.hasBar !== expectsBar) {
    console.error(`  ✗ полоска: ожидали ${expectsBar}, получили ${metrics.hasBar}`);
    failures += 1;
  }
  if (downloading && metrics.folderCy !== null) {
    console.error('  ✗ кнопка папки показана до завершения загрузки');
    failures += 1;
  }
  if (downloading && payload.download.progress === 42 && metrics.fillRatio !== 42) {
    console.error(`  ✗ заполнение полоски: ${metrics.fillRatio}% != 42%`);
    failures += 1;
  }
  if (downloading && payload.download.progress === undefined) {
    const expectedAnimation = reducedMotion ? 'none' : 'popup-progress-indeterminate';
    if (metrics.animation !== expectedAnimation) {
      console.error(
        `  ✗ бегущая полоска: анимация ${metrics.animation}, ожидали ${expectedAnimation}`,
      );
      failures += 1;
    }
    if (reducedMotion && metrics.fillRatio !== 33) {
      console.error(`  ✗ reduced-motion: статичный сегмент ${metrics.fillRatio}% != 33%`);
      failures += 1;
    }
  }
  if (!downloading && metrics.fillRatio !== null) {
    console.error('  ✗ полоска осталась после завершения загрузки');
    failures += 1;
  }
  await ctx.close();
}
await browser.close();

// Карточка не меняет размер между состояниями (#1068 + #1069).
const [reference, ...rest] = heights;
if (rest.some((h) => h !== reference)) {
  console.error(`✗ высоты разъехались: ${heights.join(', ')}`);
  failures += 1;
}
// Крестик везде на одном уровне.
if (new Set(closeLevels).size !== 1) {
  console.error(`✗ уровень крестика разъехался: ${closeLevels.join(', ')}`);
  failures += 1;
} else {
  console.log(`ok: высота всех карточек ${reference}, крестик на ${closeLevels[0]}`);
}
process.exitCode = failures === 0 ? 0 : 1;
console.log('done');
