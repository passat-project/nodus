// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFittedColumnWidths } from './use-fitted-columns.js';
import type { FieldDef, ViewField } from './use-view-fields.js';
import { uiPx } from '../ui/ui-scale.js';

/**
 * Авто-раскладка колонок (#937): ширина по содержимому, свободная ширина
 * зоны — колонкам без ручной ширины, переполнение — без сжатия ниже текста.
 * jsdom не считает layout: ширины зоны и содержимого подставляем геттерами.
 */

const ZONE = 1000;

const SIZES = ['clientWidth', 'scrollWidth', 'offsetWidth'] as const;
type Size = (typeof SIZES)[number];

/** Исходные геттеры jsdom — возвращаем их после теста. */
const originals = new Map<Size, PropertyDescriptor | undefined>();

/** jsdom отдаёт нули: подставляем ширину зоны и содержимого (data-w). */
function mockGeometry(zone = ZONE) {
  for (const size of SIZES) {
    if (!originals.has(size)) {
      originals.set(size, Object.getOwnPropertyDescriptor(HTMLElement.prototype, size));
    }
    Object.defineProperty(HTMLElement.prototype, size, {
      configurable: true,
      get(this: HTMLElement) {
        return size === 'clientWidth' ? zone : Number(this.dataset.w ?? 0);
      },
    });
  }
}

function restoreGeometry() {
  for (const size of SIZES) {
    const original = originals.get(size);
    if (original) Object.defineProperty(HTMLElement.prototype, size, original);
    else delete (HTMLElement.prototype as unknown as Record<Size, unknown>)[size];
  }
}

function field(over: Partial<ViewField<FieldDef>> & Pick<FieldDef, 'id'>): ViewField<FieldDef> {
  return { label: over.id, defaultVisible: true, visible: true, ...over };
}

/** Ячейки строятся с data-w = измеренная ширина содержимого. */
function Harness({
  fields,
  content,
  widthSet = new Set<string>(),
  hasActions = false,
}: {
  fields: ViewField<FieldDef>[];
  content: Record<string, number>;
  widthSet?: ReadonlySet<string>;
  hasActions?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widths = useFittedColumnWidths({
    containerRef: ref,
    fields,
    widthSet,
    fixedTracksPx: uiPx(48),
    fixedTracksCount: 1,
    hasActions,
    hasRows: true,
  });
  return (
    <div ref={ref}>
      <div role="row">
        <span data-w="0" />
        {fields.map((item) => (
          <span key={item.id} data-cell-field={item.id}>
            <span data-w={String(content[item.id] ?? 0)} />
          </span>
        ))}
        {hasActions ? <span data-actions-cell data-w="100" /> : null}
      </div>
      <output data-testid="widths" data-widths={JSON.stringify(widths)} />
    </div>
  );
}

function widthsOf(getByTestId: (id: string) => HTMLElement): Record<string, number> {
  return JSON.parse(getByTestId('widths').dataset.widths ?? '{}') as Record<string, number>;
}

const sum = (widths: Record<string, number>) =>
  Object.values(widths).reduce((acc, width) => acc + width, 0);

afterEach(() => {
  restoreGeometry();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('useFittedColumnWidths', () => {
  it('колонки под текст, свободная ширина зоны раздаётся им же', async () => {
    mockGeometry();
    const fields = [
      field({ id: 'subject', minWidth: 100, maxWidth: 400 }),
      field({ id: 'date', minWidth: 80 }),
    ];
    const { getByTestId } = render(
      <Harness fields={fields} content={{ subject: 300, date: 100 }} />,
    );

    await waitFor(() => expect(Object.keys(widthsOf(getByTestId))).toHaveLength(2));
    const widths = widthsOf(getByTestId);
    // Зона минус отступы строки, зазоры, ведущая колонка — ровно то, что делим.
    const available = ZONE - uiPx(16) * 2 - 2 * uiPx(12) - uiPx(48);
    expect(sum(widths)).toBe(available);
    expect(widths.subject).toBeGreaterThanOrEqual(uiPx(100));
    expect(widths.subject).toBeLessThanOrEqual(uiPx(400));
  });

  it('ширину, заданную человеком, не трогает', async () => {
    mockGeometry();
    const fields = [field({ id: 'subject', width: uiPx(200) }), field({ id: 'date' })];
    const { getByTestId } = render(
      <Harness
        fields={fields}
        content={{ subject: 20, date: 100 }}
        widthSet={new Set(['subject'])}
      />,
    );

    await waitFor(() => expect(Object.keys(widthsOf(getByTestId))).toHaveLength(2));
    expect(widthsOf(getByTestId).subject).toBe(uiPx(200));
  });

  it('содержимое шире зоны — колонки не сжимаются, уходят в скролл', async () => {
    mockGeometry();
    const fields = [field({ id: 'subject', maxWidth: 800 }), field({ id: 'date', maxWidth: 640 })];
    const { getByTestId } = render(
      <Harness fields={fields} content={{ subject: 700, date: 500 }} />,
    );

    await waitFor(() => expect(Object.keys(widthsOf(getByTestId))).toHaveLength(2));
    const widths = widthsOf(getByTestId);
    expect(widths.subject).toBe(700 + uiPx(24));
    expect(widths.date).toBe(500 + uiPx(24));
    expect(sum(widths)).toBeGreaterThan(ZONE);
  });

  it('колонка действий забирает своё место из зоны', async () => {
    mockGeometry();
    const fields = [field({ id: 'subject', maxWidth: 2000 })];
    const { getByTestId } = render(
      <Harness fields={fields} content={{ subject: 600 }} hasActions />,
    );

    await waitFor(() => expect(Object.keys(widthsOf(getByTestId))).toHaveLength(1));
    expect(sum(widthsOf(getByTestId))).toBe(ZONE - uiPx(16) * 2 - 2 * uiPx(12) - uiPx(48) - 100);
  });

  it('нераскрытая зона (0px) — раскладку не трогаем', () => {
    mockGeometry(0);
    const { getByTestId } = render(
      <Harness fields={[field({ id: 'subject' })]} content={{ subject: 300 }} />,
    );

    expect(widthsOf(getByTestId)).toEqual({});
  });

  it('повторный замер с теми же данными не меняет раскладку', async () => {
    mockGeometry();
    const content = { subject: 300 };
    const first = [field({ id: 'subject', minWidth: 100, maxWidth: 400 })];
    const { getByTestId, rerender } = render(<Harness fields={first} content={content} />);
    await waitFor(() => expect(Object.keys(widthsOf(getByTestId))).toHaveLength(1));
    const before = widthsOf(getByTestId);

    // Новый массив полей (новая ссылка) — эффект пересчитывает, но результат тот же.
    rerender(
      <Harness
        fields={[field({ id: 'subject', minWidth: 100, maxWidth: 400 })]}
        content={content}
      />,
    );

    expect(widthsOf(getByTestId)).toEqual(before);
  });
});
