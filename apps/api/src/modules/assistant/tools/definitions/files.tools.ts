import { z } from 'zod';

import { defineTool } from '../tool-definition.js';
import { asArray, asRecord, num, str } from '../projections.js';

/**
 * Чтение вложения (#922): PDF с текстовым слоем и DOCX по `fileId` из
 * метаданных письма/беседы. Текст отдаётся ПО СТРАНИЦАМ — ответ обязан
 * ссылаться на файл и страницу. Права проверяет API портала (владение,
 * участник беседы, видимое письмо): чужой файл — 404. Скан без текстового
 * слоя не выдумывается — страница помечается, агент честно говорит «не читается».
 */

/** Сколько знаков текста вложения отдаём модели (общий лимит — 16 000). */
const PROJECTION_CHARS = 14_000;

export const filesExtractTextTool = defineTool({
  id: 'files.extract_text',
  title: 'Вложения: прочитать текст',
  description:
    'Прочитать текст вложения PDF или DOCX по id файла (fileId из вложений письма, сообщения или задачи). Отдаёт текст по страницам: в ответе ссылайся на файл и страницу. Скан без текстового слоя не читается — так и скажи. Права на файл проверяет портал.',
  keywords: [
    'прочитай документ',
    'прочитать вложение',
    'текст файла',
    'что в акте',
    'смета',
    'договор',
    'pdf',
    'docx',
    'extract text',
  ],
  module: 'files',
  kind: 'read',
  hot: true,
  input: z.object({ fileId: z.uuid() }),
  api: { method: 'GET', path: '/files/:id/text' },
  build: (input) => ({ path: `/files/${input.fileId}/text` }),
  project: (data) => {
    const file = asRecord(data);
    const name = str(file?.name) ?? 'Вложение';
    const kind = str(file?.kind) === 'docx' ? 'DOCX' : 'PDF';
    const totalPages = num(file?.totalPages);
    const pages = asArray(file?.pages)
      .map((raw) => {
        const page = asRecord(raw);
        const number = num(page?.page);
        const text = str(page?.text) ?? '';
        return number ? { page: number, text } : null;
      })
      .filter((page): page is { page: number; text: string } => page !== null);
    const scanned = asArray(file?.scannedPages)
      .map((page) => num(page))
      .filter((page): page is number => page !== null);
    const header = `${name} (${kind}${totalPages ? `, ${totalPages} стр.` : ', без страниц'})`;
    const textPages = pages.filter((page) => page.text.trim().length > 0);
    if (textPages.length === 0) {
      return {
        text: `${header}: текстового слоя нет — это скан или изображения. Содержимое прочитать нельзя.`,
      };
    }
    const parts = [`Файл: ${header}`];
    let budget = PROJECTION_CHARS;
    for (const page of textPages) {
      if (budget <= 0) break;
      const text = page.text.length > budget ? page.text.slice(0, budget) : page.text;
      parts.push(`— стр. ${page.page} —`, text);
      budget -= text.length;
    }
    if (file?.truncated === true || budget <= 0) {
      parts.push('[текст сокращён по лимиту — при необходимости уточните страницу]');
    }
    if (scanned.length > 0) {
      parts.push(`Страницы без текстового слоя (не читаются): ${scanned.join(', ')}.`);
    }
    return { text: parts.join('\n') };
  },
});

export const filesTools = [filesExtractTextTool];
