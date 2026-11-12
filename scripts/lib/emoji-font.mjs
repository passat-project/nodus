import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Страж эмодзи-шрифта канона (#822) — в `scripts/`, потому что шаг
 * `pnpm test:scripts` в CI выполняется ВСЕГДА, а e2e-спека zwj-emoji-font
 * пока в CI не входит.
 *
 * Контракт: `@font-face 'Noto Color Emoji'` в общем CSS (`packages/ui`)
 * ссылается на ОТНОСИТЕЛЬНЫЙ woff2-файл рядом с собой. Абсолютный публичный
 * путь (`/app-fonts/…`) резолвится только в портале: мини-UI оболочки (попапы
 * уведомлений) собирается из другого корня, молча остаётся без шрифта и
 * рисует эмодзи системным Segoe UI Emoji — на Windows 10 это Emoji 12
 * (2019), новых эмодзи там нет вовсе.
 */

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Служебные кодпоинты составных эмодзи (канон #165): без них шейпинг-ран
 *  рвётся об текстовый шрифт стека и ZWJ-последовательности разваливаются. */
const REQUIRED_RANGE_CODEPOINTS = ['U+200D', 'U+FE0F', 'U+20E3', 'U+E0020-E007F'];

/** woff2-магия: файл действительно сконвертирован, а не переименован. */
const WOFF2_MAGIC = 'wOF2';

/**
 * Разбор `@font-face 'Noto Color Emoji'` из CSS: src-URL, формат, диапазон.
 * Бросает, если блока нет или он не разбирается — страж не должен молча
 * смотреть в пустоту.
 */
export function parseEmojiFontFace(css) {
  const start = css.indexOf("font-family: 'Noto Color Emoji'");
  if (start < 0) throw new Error('@font-face Noto Color Emoji не найден в globals.css');
  const end = css.indexOf('}', start);
  const block = css.slice(start, end);
  const src = block.match(
    /src:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)\s*format\(\s*['"]([^'"]+)['"]\s*\)/,
  );
  if (!src) throw new Error('src @font-face Noto Color Emoji не разобран');
  const range = block.match(/unicode-range:\s*([\s\S]*?);/);
  return {
    srcUrl: src[1],
    format: src[2],
    unicodeRange: range ? range[1].replace(/\s+/g, ' ').trim() : '',
  };
}

/**
 * Проверка канона: относительный woff2-путь, живой файл с магией woff2,
 * служебные кодпоинты в unicode-range. `css` — подмена для теста
 * чувствительности (проверить, что страж ловит абсолютный путь).
 * Возвращает `{ face, file, size, problems }`; `problems` пуст = канон цел.
 */
export function checkEmojiFont({ root = REPO_ROOT, css } = {}) {
  const cssPath = resolve(root, 'packages/ui/src/styles/globals.css');
  const source = css ?? readFileSync(cssPath, 'utf8');
  const face = parseEmojiFontFace(source);
  const problems = [];

  const absoluteSrc = /^(\/|[a-z][a-z0-9+.-]*:)/i.test(face.srcUrl);
  if (absoluteSrc) {
    problems.push(
      `src не относительный (${face.srcUrl}) — в бандле мини-UI оболочки такой путь не резолвится (#822)`,
    );
  }
  if (!face.srcUrl.endsWith('.woff2')) {
    problems.push(`src не woff2 (${face.srcUrl}) — TTF в 4.4 раза тяжелее для портала и оболочки`);
  }
  if (face.format !== 'woff2') {
    problems.push(`format() не woff2 (${face.format}) — браузер не выберет файл`);
  }
  for (const codepoint of REQUIRED_RANGE_CODEPOINTS) {
    if (!face.unicodeRange.includes(codepoint)) {
      problems.push(`unicode-range потерял ${codepoint} — ZWJ-эмодзи развалятся (#165)`);
    }
  }

  const file = resolve(dirname(cssPath), face.srcUrl);
  let size = 0;
  try {
    const bytes = readFileSync(file);
    size = bytes.length;
    if (bytes.subarray(0, 4).toString('latin1') !== WOFF2_MAGIC) {
      problems.push(`${face.srcUrl} — не woff2 (нет магии ${WOFF2_MAGIC})`);
    }
  } catch {
    problems.push(`файла шрифта нет: ${file}`);
  }

  return { face, file, size, problems };
}
