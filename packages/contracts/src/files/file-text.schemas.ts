import { z } from 'zod';

/**
 * Текст вложения для ИИ-агента (#922): PDF с текстовым слоем и DOCX.
 * Права — те же, что у открытия вложения в портале (FileAccessRegistry:
 * владение, участник беседы, видимое письмо); чужие — 404.
 *
 * Страницы идут отдельными блоками: ответ обязан ссылаться на файл и
 * страницу. Скан без текстового слоя не выдумывается — страница попадает в
 * `scannedPages`, и агент честно говорит, что содержимое не читается.
 */

export const fileTextKindSchema = z.enum(['pdf', 'docx']);
export type FileTextKind = z.infer<typeof fileTextKindSchema>;

export const fileTextPageSchema = z.object({
  /** Номер страницы с 1; у DOCX страниц нет — одна запись с номером 1. */
  page: z.number().int().positive(),
  text: z.string(),
});
export type FileTextPage = z.infer<typeof fileTextPageSchema>;

export const fileTextResponseSchema = z.object({
  fileId: z.uuid(),
  name: z.string().min(1),
  kind: fileTextKindSchema,
  /** Всего страниц; null — формат без страниц (DOCX). */
  totalPages: z.number().int().positive().nullable(),
  /** Сколько страниц реально извлечено (лимит страниц/знаков). */
  pagesRead: z.number().int().nonnegative(),
  pages: z.array(fileTextPageSchema),
  chars: z.number().int().nonnegative(),
  /** Текст обрезан лимитом — честная пометка для ответа. */
  truncated: z.boolean(),
  /** Страницы без текстового слоя (скан/картинки) — содержимое не читается. */
  scannedPages: z.array(z.number().int().positive()),
});
export type FileTextResponse = z.infer<typeof fileTextResponseSchema>;
