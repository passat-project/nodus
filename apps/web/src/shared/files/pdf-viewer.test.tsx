// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import { getDocument } from 'pdfjs-dist';

import { PDFJS_WASM_BASE } from './pdfjs-wasm-url.js';
import { PdfViewer } from './pdf-viewer.js';

// Загрузка навсегда pending: тестируется только аргумент getDocument —
// рендер страниц (canvas) вне скоупа, компонент остаётся в загрузке.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({
    promise: new Promise(() => undefined),
    destroy: vi.fn(),
  })),
}));

/** #617: pdf.js 6.x грузит WASM-декодеры сканов (JBIG2/CCITT/JPX) по
 *  требованию — без базы wasmUrl битональные сканы рендерятся мусором. */
describe('PdfViewer: база WASM-декодеров (#617)', () => {
  it('getDocument получает wasmUrl', () => {
    render(<PdfViewer url="/files/scan.pdf" fileName="scan.pdf" />);
    expect(getDocument).toHaveBeenCalledWith({
      url: '/files/scan.pdf',
      wasmUrl: PDFJS_WASM_BASE,
    });
  });
});
