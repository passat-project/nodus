import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { checkEmojiFont, parseEmojiFontFace, REPO_ROOT } from './emoji-font.mjs';

/**
 * Страж эмодзи-шрифта (#822). Класс бага, который ловим: общий CSS
 * дизайн-системы ссылался на абсолютный публичный путь `/app-fonts/…` —
 * в портале он отдаётся статикой, а в мини-UI оболочки (попапы) такого файла
 * нет; `@font-face` падал в 404, и попапы рисовали эмодзи системным шрифтом
 * (на Windows 10 — Emoji 12, новых эмодзи нет).
 */

const CSS_PATH = `${REPO_ROOT}/packages/ui/src/styles/globals.css`;

describe('эмодзи-шрифт канона (globals.css)', () => {
  it('относительный woff2 рядом с CSS, файл на месте, служебные кодпоинты в диапазоне', () => {
    const { face, size, problems } = checkEmojiFont();
    assert.deepEqual(problems, [], problems.join('\n'));
    assert.equal(face.srcUrl, '../assets/NotoColorEmoji.woff2');
    // Здоровье файла: полный набор эмодзи не бывает мелким (≈5.8 МБ woff2).
    assert.ok(size > 1_000_000, `шрифт подозрительно мал: ${size} байт`);
  });

  it('страж ловит возврат абсолютного публичного пути (класс бага #822)', () => {
    const css = readFileSync(CSS_PATH, 'utf8').replace(
      "url('../assets/NotoColorEmoji.woff2')",
      "url('/app-fonts/NotoColorEmoji.woff2')",
    );
    const { problems } = checkEmojiFont({ css });
    assert.equal(
      problems.some((problem) => problem.includes('не относительный')),
      true,
      `абсолютный путь не пойман: ${problems.join('; ')}`,
    );
  });

  it('страж ловит потерю ZWJ/VS16/кейкапа в unicode-range (регресс #165)', () => {
    const css = readFileSync(CSS_PATH, 'utf8').replace('U+200D,', '');
    const { problems } = checkEmojiFont({ css });
    assert.equal(
      problems.some((problem) => problem.includes('U+200D')),
      true,
      `потеря U+200D не поймана: ${problems.join('; ')}`,
    );
  });

  it('разбор @font-face падает громко, если блок исчез', () => {
    assert.throws(() => parseEmojiFontFace('body { color: red }'), /не найден/);
  });
});
