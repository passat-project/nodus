import { z } from 'zod';

/**
 * Денормализованный снапшот сотрудника в чужих DTO (задачи, письма, чаты):
 * списки не ходят в справочник за каждым именем. Актуальное имя — в directory.
 */
export const userRefSchema = z.object({
  id: z.uuid(),
  displayName: z.string().min(1),
  /** Аватар — файл-дериват (#192): ОТНОСИТЕЛЬНЫЙ подписанный путь
   * `/api/v1/files/<id>/content?exp=&sig=` (SignedUrlService.fileContentUrl),
   * null — инициалы. Не `z.url()`: тот требует абсолютный URL и отбрасывал
   * живые payload с аватаром (ломал попапы чата, #880). Канон подписных
   * ссылок — строка, как у вложений (messageAttachmentSchema.url). */
  avatarUrl: z.string().nullable(),
});

export type UserRef = z.infer<typeof userRefSchema>;
