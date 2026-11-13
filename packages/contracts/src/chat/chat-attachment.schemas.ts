import { z } from 'zod';

/** Переименование вложения (#146/#188): имя файла окна. Расширение правит
 *  только UI (защита от случайной поломки), сервер принимает любое имя
 *  1–255 символов — как у имён файлов. Общая форма отправки и правки
 *  сообщения: тело окна одно, меняется лишь маршрут применения. */
export const attachmentRenameSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(255),
});

export type AttachmentRename = z.infer<typeof attachmentRenameSchema>;
