import { describe, expect, it } from 'vitest';
import type { FileTextResponse } from '@nodus/contracts';

import { filesExtractTextTool } from './files.tools.js';

/**
 * files.extract_text (#922): проекция текста по страницам с честными
 * пометками. Скан без слоя не выдумывается, усечение и права — на API;
 * здесь — только то, что увидит модель. Фикстуры — полный `FileTextResponse`
 * (проекция типизирована контрактом, ADR-0049).
 */

const FILE_ID = '11111111-1111-4111-8111-111111111111';

function response(overrides: Partial<FileTextResponse>): FileTextResponse {
  return {
    fileId: FILE_ID,
    name: 'Документ.pdf',
    kind: 'pdf',
    totalPages: 1,
    pagesRead: 1,
    pages: [{ page: 1, text: 'Текст' }],
    chars: 5,
    truncated: false,
    scannedPages: [],
    ...overrides,
  };
}

describe('files.extract_text: текст по страницам (#922)', () => {
  it('PDF: шапка с видом и числом страниц, текст по страницам', () => {
    const { text } = filesExtractTextTool.project!(
      response({
        name: 'Акт КС-2.pdf',
        totalPages: 2,
        pagesRead: 2,
        pages: [
          { page: 1, text: 'Акт выполненных работ' },
          { page: 2, text: 'Итого: 1 200 000 руб.' },
        ],
        chars: 44,
      }),
      {},
    );
    expect(text).toContain('Акт КС-2.pdf (PDF, 2 стр.)');
    expect(text).toContain('— стр. 1 —');
    expect(text).toContain('Акт выполненных работ');
    expect(text).toContain('— стр. 2 —');
    expect(text).toContain('Итого: 1 200 000 руб.');
  });

  it('DOCX: без числа страниц и одной страницей', () => {
    const { text } = filesExtractTextTool.project!(
      response({
        name: 'Смета.docx',
        kind: 'docx',
        totalPages: null,
        pages: [{ page: 1, text: 'Смета на монтаж' }],
      }),
      {},
    );
    expect(text).toContain('Смета.docx (DOCX, без страниц)');
    expect(text).toContain('Смета на монтаж');
  });

  it('скан без текстового слоя — честный отказ без выдумывания', () => {
    const { text } = filesExtractTextTool.project!(
      response({
        name: 'Скан.pdf',
        pages: [{ page: 1, text: '   ' }],
        scannedPages: [1],
      }),
      {},
    );
    expect(text).toContain('текстового слоя нет');
    expect(text).toContain('Содержимое прочитать нельзя');
    expect(text).not.toContain('— стр. 1 —');
  });

  it('частичные сканы и усечение помечаются отдельными строками', () => {
    const { text } = filesExtractTextTool.project!(
      response({
        name: 'Дело.pdf',
        totalPages: 3,
        pagesRead: 2,
        pages: [
          { page: 1, text: 'Первая страница акта' },
          { page: 3, text: '' },
        ],
        scannedPages: [2, 3],
        truncated: true,
      }),
      {},
    );
    expect(text).toContain('Страницы без текстового слоя (не читаются): 2, 3.');
    expect(text).toContain('текст сокращён по лимиту');
  });

  it('длинный текст обрезается по лимиту проекции', () => {
    const { text } = filesExtractTextTool.project!(
      response({
        name: 'Длинный.pdf',
        pages: [{ page: 1, text: 'я'.repeat(20_000) }],
        chars: 20_000,
      }),
      {},
    );
    expect(text.length).toBeLessThan(15_000);
    expect(text).toContain('текст сокращён по лимиту');
  });

  it('пустой ответ API — подпись «Вложение», без падения', () => {
    const { text } = filesExtractTextTool.project!({} as never, {});
    expect(text).toContain('Вложение (PDF, без страниц)');
  });
});
