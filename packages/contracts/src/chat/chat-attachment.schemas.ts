import { z } from 'zod';

import { stickerMetaSchema } from './sticker.schemas.js';

/** Вложение сообщения (#150, #250): вид, ссылки, геометрия, длительность
 *  видео. Живёт рядом с переименованием вложения — оба контракта про файлы
 *  сообщения (I5: chat.schemas.ts не разрастается). */
export const messageAttachmentSchema = z.object({
  id: z.uuid(),
  /** Файл модуля files (сессия просмотра/версии, #138); plain UUID (I3). */
  fileId: z.uuid(),
  name: z.string().min(1),
  size: z.number().int().min(0),
  mime: z.string().min(1),
  /** Явный вид, не из mime: image — галерея, video — медиа-плитка с постером
   *  (#250), file — чип, sticker — стикер-глиф без пузыря (#143). */
  kind: z.enum(['image', 'video', 'file', 'sticker']),
  /** Метаданные стикера (только kind='sticker'): пак для поповера «Добавить
   *  пак» и рендер без доп-запроса; снапшот на момент отправки (#143). */
  sticker: stickerMetaSchema.nullish(),
  /** Адрес оригинала (в проде — MinIO через StorageDriver, I13). */
  url: z.string().nullable(),
  /** Превью для галереи (null у файлов). */
  thumbnailUrl: z.string().nullable(),
  /** Маршрут просмотрщика (#139): office | pdf | image | video | file —
   * серверная классификация (mime/расширению клиента не доверяем). */
  previewKind: z.enum(['office', 'pdf', 'image', 'video', 'file']),
  /** PDF-копия офисного документа (конвейер производных #139): fallback-
   * просмотр при выключенном/лежащем ONLYOFFICE; null — не готова/не офис. */
  pdfUrl: z.string().nullable(),
  /** Габариты изображения: резерв бокса до загрузки (лента без сдвига). */
  width: z.number().int().min(0).nullable(),
  height: z.number().int().min(0).nullable(),
  /** Длительность видео (мс, #250): клиент — подсказка, ffprobe — авторитетно;
   *  optional у старых событий/фикстур (undefined трактуется как null). */
  durationMs: z.number().int().min(0).nullable().optional(),
});

export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

/** Переименование вложения (#146/#188): имя файла окна. Расширение правит
 *  только UI (защита от случайной поломки), сервер принимает любое имя
 *  1–255 символов — как у имён файлов. Общая форма отправки и правки
 *  сообщения: тело окна одно, меняется лишь маршрут применения. */
export const attachmentRenameSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
});

export type AttachmentRename = z.infer<typeof attachmentRenameSchema>;
