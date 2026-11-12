import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * Гейт ZWJ-эмодзи (#165): canvas-скан ширин ВСЕХ эмодзи emoji-data.json
 * в трёх @font-face-контекстах. Лигатура = ширина последовательности ≈
 * ширине одного глифа; развал = сумма компонент (N × глиф).
 *
 * - контекст «прод» — текстовый шрифт → Noto с ПРОДАКШЕННЫМ диапазоном,
 *   распарсенным из globals.css (не копией — гейт честен к правке канона);
 * - контекст «шрифт» — Noto в одиночку без unicode-range: здоровье самого
 *   файла (noto-emoji#526 — свежие билды теряли семейные лигатуры);
 * - контекст «баг» — старый диапазон БЕЗ U+200D/U+20E3/U+E0020-E007F:
 *   репродукция бага #165, доказывает чувствительность гейта к откату.
 *
 * Шрифт — woff2 из пакета дизайн-системы (тот же файл, что Vite эмитит в
 * бандлы портала И мини-UI оболочки: попапы получают канонный Noto, а не
 * системный шрифт — #822).
 *
 * Самодостаточен: страница/шрифт/данные отдаются через page.route —
 * живой стек и порты не нужны. В CI-список e2e-шага спека не входит;
 * постоянный страж канона (относительный url + woff2 + диапазон) живёт в
 * scripts/lib/emoji-font.test.mjs, он выполняется в `pnpm test:scripts`.
 */

const FONT_URL = new URL('../../../packages/ui/src/assets/NotoColorEmoji.woff2', import.meta.url);
const DATA_URL = new URL('../../../apps/web/public/emoji/emoji-data.json', import.meta.url);
const CSS_URL = new URL('../../../packages/ui/src/styles/globals.css', import.meta.url);

/** Диапазон @font-face 'Noto Color Emoji' из канона (globals.css). */
async function productionUnicodeRange(): Promise<string> {
  const css = await readFile(CSS_URL, 'utf8');
  const block = css.slice(css.indexOf("font-family: 'Noto Color Emoji'"));
  const match = block.match(/unicode-range:\s*([\s\S]*?);/);
  const range = match?.[1];
  if (!range) throw new Error('unicode-range не найден в globals.css');
  return range.replace(/\s+/g, ' ').trim();
}

const PAGE_HTML = (prodRange: string, oldRange: string) => `
<!doctype html><html><head><style>
  @font-face { font-family: 'NCE-PROD'; src: url('/font.woff2') format('woff2');
    unicode-range: ${prodRange}; }
  @font-face { font-family: 'NCE-ALONE'; src: url('/font.woff2') format('woff2'); }
  @font-face { font-family: 'NCE-OLD'; src: url('/font.woff2') format('woff2');
    unicode-range: ${oldRange}; }
</style></head><body><canvas id="c"></canvas></body></html>`;

test.describe('ZWJ-эмодзи шрифтом Noto Color Emoji (#165)', () => {
  test('все глифы — одна лигатура в прод-стеке и в самом шрифте', async ({ page }) => {
    const [font, dataRaw, prodRange] = await Promise.all([
      readFile(FONT_URL),
      readFile(DATA_URL, 'utf8'),
      productionUnicodeRange(),
    ]);

    // Диапазон обязан заявлять служебные кодпоинты составных эмодзи —
    // иначе шейпинг-ран рвётся об текстовый шрифт стека (google/fonts#9729).
    for (const cp of ['U+200D', 'U+20E3', 'U+E0020-E007F']) {
      expect(prodRange, `globals.css unicode-range потерял ${cp}`).toContain(cp);
    }
    const oldRange = prodRange
      .replace(/U\+200D,?\s*/g, '')
      .replace(/U\+20E3,?\s*/g, '')
      .replace(/U\+E0020-E007F,?\s*/g, '');

    await page.route('**/*', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/font.woff2') return route.fulfill({ contentType: 'font/woff2', body: font });
      if (path === '/data.json')
        return route.fulfill({ contentType: 'application/json', body: dataRaw });
      return route.fulfill({ contentType: 'text/html', body: PAGE_HTML(prodRange, oldRange) });
    });
    await page.goto('https://zwj-scan.local/');

    // Стеки: прод — как --font-sans (текстовый шрифт раньше эмодзи);
    // старые дефолты (Arial/Liberation/DejaVu) ни в одной платформе не
    // мапят ZWJ — роль «текстового» шрифта воспроизводима.
    const result = await page.evaluate(async () => {
      const data = (await (await fetch('/data.json')).json()) as {
        groups: { emojis: { e: string }[] }[];
      };
      const emojis = data.groups.flatMap((g) => g.emojis.map((x) => x.e));
      await Promise.all([
        document.fonts.load('32px "NCE-PROD"', '😀'),
        document.fonts.load('32px "NCE-ALONE"', '😀'),
        document.fonts.load('32px "NCE-OLD"', '😀'),
      ]);
      await document.fonts.ready;

      const ctx = (document.getElementById('c') as HTMLCanvasElement).getContext('2d')!;
      const stacks = {
        prod: '32px Arial, "Liberation Sans", "DejaVu Sans", "NCE-PROD", sans-serif',
        alone: '32px "NCE-ALONE"',
        old: '32px Arial, "Liberation Sans", "DejaVu Sans", "NCE-OLD", sans-serif',
      };
      const width = (stack: string, text: string) => {
        ctx.font = stack;
        return ctx.measureText(text).width;
      };

      const out: Record<keyof typeof stacks, { broken: string[]; baseline: number }> = {
        prod: { broken: [], baseline: 0 },
        alone: { broken: [], baseline: 0 },
        old: { broken: [], baseline: 0 },
      };
      for (const key of Object.keys(stacks) as (keyof typeof stacks)[]) {
        const singles = emojis.filter((e) => Array.from(e).length === 1);
        const widths = singles.map((e) => width(stacks[key], e)).sort((a, b) => a - b);
        out[key].baseline = widths[Math.floor(widths.length / 2)] ?? 0;
        for (const e of emojis) {
          if (width(stacks[key], e) > out[key].baseline * 1.6) out[key].broken.push(e);
        }
      }
      return out;
    });

    // Сам шрифт: каждая последовательность обязана быть лигатурой
    // (иначе файл деградировал — noto-emoji#526) — замена файла, не правка CSS.
    expect(result.alone.broken, `шрифт без лигатур: ${result.alone.broken.join(' ')}`).toEqual([]);

    // Прод-стек с диапазоном из globals.css: то же самое через текстовый
    // шрифт стека — регрессия диапазона ловится здесь.
    expect(result.prod.broken, `развал в прод-стеке: ${result.prod.broken.join(' ')}`).toEqual([]);

    // Репродукция бага: старый диапазон без U+200D разваливает ZWJ-серии.
    test
      .info()
      .annotations.push(
        { type: 'baseline', description: `${result.prod.baseline.toFixed(1)}px` },
        { type: 'old-range-broken', description: String(result.old.broken.length) },
      );
    expect(result.old.broken.length, 'гейт нечувствителен к откату диапазона').toBeGreaterThan(100);
  });
});
