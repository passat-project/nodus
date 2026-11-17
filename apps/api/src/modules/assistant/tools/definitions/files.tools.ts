import { z } from 'zod';
import type { FileTextResponse } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { filesMeta } from './meta/files.meta.js';

/**
 * Чтение вложения (#922): PDF с текстовым слоем и DOCX по `fileId` из
 * метаданных письма/беседы. Текст отдаётся ПО СТРАНИЦАМ — ответ обязан
 * ссылаться на файл и страницу. Права проверяет API портала (владение,
 * участник беседы, видимое письмо): чужой файл — 404, конфиденциальное
 * письмо — 403 (не читается ИИ ни при каком режиме). Скан без текстового
 * слоя не выдумывается — страница помечается, агент честно говорит «не читается».
 *
 * Проекция типизирована контрактом (`FileTextResponse`, ADR-0049): изменение
 * DTO ломает сборку, а не даёт пустой ответ модели.
 */

/** Сколько знаков текста вложения отдаём модели (общий лимит — 16 000). */
const PROJECTION_CHARS = 14_000;

export const filesExtractTextTool = defineTool({
  ...filesMeta['files.extract_text'],
  id: 'files.extract_text',
  title: 'Вложения: прочитать текст',
  description:
    'Прочитать текст вложения PDF или DOCX по id файла (fileId из вложений письма, сообщения или задачи). Отдаёт текст по страницам: в ответе ссылайся на файл и страницу. Скан без текстового слоя не читается — так и скажи. Права на файл проверяет портал; вложения конфиденциальных писем не читаются.',
  keywords: [
    'прочитай документ',
    'прочитать вложение',
    'текст файла',
    'что в акте',
    'приложенный акт',
    'смета',
    'договор',
    'pdf',
    'docx',
    'extract text',
  ],
  module: 'files',
  kind: 'read',
  // Маршрут текста живёт под флагом ассистента (ADR-0050 п.1): без него
  // инструмент не должен попадать в каталог и карту поверхностей.
  featureFlag: 'assistant',
  hot: true,
  input: z.object({ fileId: z.uuid() }),
  api: { method: 'GET', path: '/files/:id/text' },
  build: (input) => ({ path: `/files/${input.fileId}/text` }),
  project: (data: FileTextResponse) => {
    const name = data?.name || 'Вложение';
    const kind = data?.kind === 'docx' ? 'DOCX' : 'PDF';
    const totalPages = data?.totalPages ?? null;
    const pages = (data?.pages ?? []).filter(
      (page) => page && typeof page.text === 'string' && typeof page.page === 'number',
    );
    const scanned = (data?.scannedPages ?? []).filter((page) => typeof page === 'number');
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
    if (data?.truncated === true || budget <= 0) {
      parts.push('[текст сокращён по лимиту — при необходимости уточните страницу]');
    }
    if (scanned.length > 0) {
      parts.push(`Страницы без текстового слоя (не читаются): ${scanned.join(', ')}.`);
    }
    return { text: parts.join('\n') };
  },
});

export const filesTools = [filesExtractTextTool];
