import { describe, expect, it } from 'vitest';

import { lettersAttachmentsTool } from './letters.tools.js';

/**
 * Границы данных вложений (#892, ADR-0043 п. 8, ADR-0044 п. 5, ADR-0050):
 * инструмент отдаёт метаданные и `fileId` — по нему `files.extract_text`
 * читает текст. Подписанные ссылки (`url`, `pdfUrl`) наружу не проходят:
 * содержимое доступно только через API портала с проверкой прав.
 */

const letterDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  regNumber: 'Вх-2026/118',
  subject: 'О согласовании проекта',
  attachments: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      fileId: '33333333-3333-4333-8333-333333333333',
      role: 'main',
      name: 'Договор.pdf',
      mime: 'application/pdf',
      size: 512_000,
      contentId: null,
      inline: false,
      // Секреты подписи: не должны попасть в проекцию.
      url: '/api/v1/files/33333333-3333-4333-8333-333333333333/content?exp=1&sig=SECRET',
      pdfUrl: '/api/v1/files/33333333-3333-4333-8333-333333333333/content?pdf=1&sig=SECRET',
      previewKind: 'pdf',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      fileId: '55555555-5555-4555-8555-555555555555',
      role: 'attachment',
      name: 'Смета.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 48_000,
      contentId: null,
      inline: false,
      url: '/api/v1/files/55555555-5555-4555-8555-555555555555/content?sig=SECRET',
      pdfUrl: null,
      previewKind: 'office',
    },
  ],
};

describe('letters.attachments: только метаданные (#892)', () => {
  it('отдаёт имя, формат и размер каждого вложения', () => {
    const result = lettersAttachmentsTool.project!(letterDetail, { id: letterDetail.id });
    expect(result.text).toContain('Договор.pdf');
    expect(result.text).toContain('application/pdf');
    expect(result.text).toContain('500 КБ');
    expect(result.text).toContain('Смета.xlsx');
  });

  it('отдаёт fileId для files.extract_text, но не подписанные ссылки', () => {
    const { text } = lettersAttachmentsTool.project!(letterDetail, { id: letterDetail.id });
    for (const forbidden of ['sig=', 'SECRET', '/api/v1/files', 'http']) {
      expect(text, `в проекции не должно быть «${forbidden}»`).not.toContain(forbidden);
    }
    // fileId — внутренний UUID: без него агент не может прочитать PDF/DOCX.
    for (const attachment of letterDetail.attachments) {
      expect(text).toContain(attachment.fileId);
    }
  });

  it('письмо без вложений — честный ответ, а не пустой блок', () => {
    const result = lettersAttachmentsTool.project!(
      { id: letterDetail.id, attachments: [] },
      {
        id: letterDetail.id,
      },
    );
    expect(result.text).toBe('У письма нет вложений');
  });
});
