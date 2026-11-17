import { describe, expect, it } from 'vitest';

import { fileTextResponseSchema } from './file-text.schemas.js';

/**
 * Текст вложения (#922): контракт ответа `GET /files/:id/text`. Клиент и
 * инструмент ассистента разбирают одну форму — страницы, сканы и честные
 * пометки об усечении.
 */

const FILE_ID = '11111111-1111-4111-8111-111111111111';

const response = {
  fileId: FILE_ID,
  name: 'Акт КС-2.pdf',
  kind: 'pdf',
  totalPages: 2,
  pagesRead: 2,
  pages: [
    { page: 1, text: 'Акт выполненных работ' },
    { page: 2, text: '' },
  ],
  chars: 22,
  truncated: false,
  scannedPages: [2],
};

describe('fileTextResponseSchema (#922)', () => {
  it('валидный ответ: страницы, скан-страницы и вид', () => {
    expect(fileTextResponseSchema.parse(response)).toEqual(response);
  });

  it('DOCX без страниц: totalPages null допустим', () => {
    expect(
      fileTextResponseSchema.parse({
        ...response,
        kind: 'docx',
        totalPages: null,
        pages: [{ page: 1, text: 'Смета' }],
        scannedPages: [],
      }).totalPages,
    ).toBeNull();
  });

  it('неизвестный вид и пустое имя отклоняются', () => {
    expect(fileTextResponseSchema.safeParse({ ...response, kind: 'xlsx' }).success).toBe(false);
    expect(fileTextResponseSchema.safeParse({ ...response, name: '' }).success).toBe(false);
    expect(
      fileTextResponseSchema.safeParse({ ...response, pages: [{ page: 0, text: '' }] }).success,
    ).toBe(false);
  });
});
