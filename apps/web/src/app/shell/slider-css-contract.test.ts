import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Контракт #948 ↔ #1017: «открыта карточка-слайдер» CSS узнаёт по атрибуту
 * `data-slider-open` на корне, который ставит сам `SliderPanel`. Возврат
 * селектора `html:has(section.slider-shadow)` (или любого другого `:has()`
 * с якорем на корне) снова включит полную инвалидацию стилей: каждая вставка
 * узла — хоть буква в мессенджере — пересчитает весь документ (gotchas
 * frontend.md, «`:has()` на корне (и `group-has-*`)»). Этот тест держит связь
 * имени атрибута с правилом: переименование в CSS или возврат `:has()` на
 * корне падают здесь, а не в приёмке владельца.
 */
const GLOBALS_CSS = fileURLToPath(
  new URL('../../../../../packages/ui/src/styles/globals.css', import.meta.url),
);
// Комментарии в globals.css упоминают запрещённый селектор — сверяем только код.
const css = readFileSync(GLOBALS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('CSS-контракт #948/#1017: признак открытой карточки', () => {
  it('полосы таблиц за карточкой скрывает html[data-slider-open]', () => {
    expect(css).toContain("html[data-slider-open] #content [role='table']");
    expect(css).toContain("html[data-slider-open] #content [role='table']::-webkit-scrollbar");
  });

  it('на корне нет :has() — иначе ввод пересчитывает стили всего документа', () => {
    expect(css).not.toMatch(/(?:^|[\s,{])(?:html|:root|body)\s*:has\(/m);
  });
});
