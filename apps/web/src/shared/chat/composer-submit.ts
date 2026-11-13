import type { SendChatVars } from './send-message.js';
import type { EditDraft, PendingAttachment, ReplyDraft } from './chat-drafts.js';
import type { StickerSubmitPayload } from './sticker-api.js';
import { toReplyPreview } from './reply-snapshot.js';

/** Payload отправки композера (#87): текст + готовые вложения + контекст
 *  ответа/правки. Хост решает: edit ≠ null → мутация правки; иначе — отправка
 *  (attachmentIds/replyToId из payload). Пересылка (бар ForwardBanner)
 *  обрабатывается ВНУТРИ композера: текст = комментарий к блоку.
 *  Стикер (#143) — отдельный payload: поле приоритетнее текста (отправка
 *  кликом из вкладки стикеров, мимо textarea).
 *  editComposition (#188): правка пришла из ОКНА вложений — payload несёт
 *  полный итоговый состав (attachmentIds/renames); инлайн-правка композера
 *  (флаг не задан) меняет только текст. Дом: рядом с маппингом toSendVars
 *  (I5-сплит из chat-composer.tsx, #294). */
export interface ComposerSubmit {
  text: string;
  attachments: PendingAttachment[];
  reply: ReplyDraft | null;
  edit: EditDraft | null;
  editComposition?: boolean;
  sticker?: StickerSubmitPayload | null;
  /** «Важное» (#177): молния композера; requireAck — чекбокс подтверждения
   *  (осмыслен только с urgent, сервер клампит). */
  urgent?: boolean;
  requireAck?: boolean;
}

/** Лимит текста сообщения (контракт text.max(4000), спека): превалидация в
 *  композере (раунд 3) — серверный 422 не должен съедать текст. */
export const MESSAGE_TEXT_LIMIT = 4000;
/** Счётчик виден, когда до лимита ближе этого порога. */
export const MESSAGE_TEXT_COUNTER_FROM = 3500;

/** Состояние превалидации длины (чистая функция — unit-тесты на границе). */
export function messageLimitState(length: number): { over: boolean; counter: string | null } {
  return {
    over: length > MESSAGE_TEXT_LIMIT,
    counter: length > MESSAGE_TEXT_COUNTER_FROM ? `${length} / ${MESSAGE_TEXT_LIMIT}` : null,
  };
}

/** ComposerSubmit → SendChatVars: готовые вложения → attachmentIds + превью
 *  для оптимистичного temp-сообщения; черновик ответа → поля цитаты.
 *  Стикер (#143) — приоритетная ветка: отдельное сообщение без текста,
 *  черновик композера не съедается (keepDraft); активный ответ уходит
 *  ответом-стикером (#288, канон Telegram) — ветка НЕ обнуляет цитату. */
export function toSendVars(submit: ComposerSubmit): SendChatVars {
  if (submit.sticker) {
    return {
      text: '',
      stickerId: submit.sticker.stickerId,
      attachments: [submit.sticker.attachment],
      replyToId: submit.reply?.messageId ?? null,
      quoteText: submit.reply?.quoteText ?? null,
      reply: submit.reply ? toReplyPreview(submit.reply) : null,
      keepDraft: true,
    };
  }
  const ready = submit.attachments.flatMap((item) =>
    item.attachment ? [{ item, attachment: item.attachment }] : [],
  );
  // Переименование в окне отправки (#146): файл уже загружен с исходным
  // именем — новое имя уходит отдельным списком (сервер применит в
  // транзакции claim); превью темп-сообщения тоже несёт имя окна.
  const renames = ready.flatMap(({ item, attachment }) => {
    const name = item.fileName.trim();
    return name.length > 0 && name !== attachment.name ? [{ id: attachment.id, name }] : [];
  });
  return {
    text: submit.text,
    attachmentIds: ready.map(({ attachment }) => attachment.id),
    attachmentRenames: renames.length > 0 ? renames : undefined,
    // attachments — СЕРВЕРНЫЕ имена (возврат упавшей отправки не теряет
    // diff переименования); имя окна — только в превью темп-пузыря.
    attachments: ready.map(({ attachment }) => attachment),
    optimisticAttachments: ready.map(({ item, attachment }) =>
      item.fileName.trim() && item.fileName.trim() !== attachment.name
        ? { ...attachment, name: item.fileName.trim() }
        : attachment,
    ),
    replyToId: submit.reply?.messageId ?? null,
    quoteText: submit.reply?.quoteText ?? null,
    reply: submit.reply ? toReplyPreview(submit.reply) : null,
    urgent: submit.urgent ?? false,
  };
}
