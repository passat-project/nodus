import type { MessageAttachment, ReplyPreview } from '@nodus/contracts';

import type { ChatDraft, PendingAttachment } from './chat-drafts.js';
import { fromWireText } from './composer-mention-registry.js';
import { replyDraftFromPreview } from './reply-snapshot.js';

/** Состав упавшей отправки для возврата в поле (#248): ровно то, что ушло
 *  в мутацию — wire-текст, превью ответа, флаг «Важное», готовые вложения
 *  (сервер их не claimed — повтор не перекачает файлы). */
export interface FailedSendRestore {
  wireText: string;
  reply: ReplyPreview | null;
  urgent: boolean;
  attachments: MessageAttachment[];
  /** Переименования окна отправки (#146): имя строки восстанавливается
   *  в fileName, а attachment остаётся СЕРВЕРНЫМ — иначе повторная отправка
   *  не увидела бы diff имён и сервер сохранил бы старое имя. */
  attachmentRenames?: Array<{ id: string; name: string }>;
}

/** Строка окна вложений из серверного DTO (#248, тот же маппинг, что у строк
 *  правимого сообщения): файл уже загружен — id строки = id вложения, превью
 *  серверное (objectURL исходной загрузки не восстановить, DTO несёт
 *  thumbnailUrl). */
export function pendingRowFromAttachment(
  a: MessageAttachment,
  fileName = a.name,
): PendingAttachment {
  return {
    localId: a.id,
    fileName,
    mime: a.mime,
    size: a.size,
    progress: 1,
    status: 'ready',
    attachment: a,
    objectUrl: null,
  };
}

/** Возврат упавшей отправки в черновик (модель Telegram, #248; инвариант
 *  #124 — потерянного текста нет). Пустое поле — состав возвращается целиком:
 *  wire→display с чипами упоминаний, ответ, молния, вложения. Занятое
 *  (пользователь уже набирает следующее) — упавший текст добавляется в
 *  начало ПЛОСКИМ текстом (wire-токены не смешиваются с новым набором),
 *  диапазоны чипов нового текста сдвигаются точно, без диффа-эвристики
 *  setText (жадный префикс рвёт чипы); ответ/молния остаются от нового
 *  набора. Контекст, начатый за полёт (ответ/молния при пустом поле), не
 *  затирается — дополняется отсутствующим. */
export function restoreFailedIntoDraft(d: ChatDraft, failed: FailedSendRestore): ChatDraft {
  const parsed = fromWireText(failed.wireText);
  const renamed = new Map((failed.attachmentRenames ?? []).map((r) => [r.id, r.name]));
  const rows = failed.attachments.map((a) =>
    pendingRowFromAttachment(a, renamed.get(a.id) ?? a.name),
  );
  const attachments = [...rows, ...d.attachments];
  const typing = d.text !== '' || (d.mentions ?? []).length > 0;
  if (!typing) {
    const restoredReply = failed.reply ? replyDraftFromPreview(failed.reply) : null;
    return {
      ...d,
      text: parsed.text,
      mentions: parsed.mentions,
      reply: d.reply ?? restoredReply,
      urgent: failed.urgent || d.urgent,
      attachments,
    };
  }
  if (parsed.text === '') return { ...d, attachments };
  const delta = parsed.text.length + 1; // + разделительный перенос перед новым набором
  return {
    ...d,
    text: `${parsed.text}\n${d.text}`,
    mentions: (d.mentions ?? []).map((m) => ({
      ...m,
      start: m.start + delta,
      end: m.end + delta,
    })),
    attachments,
  };
}
