import type { QueryClient } from '@tanstack/react-query';
import { chatMessageSentPayloadSchema, stripMentionTokens, ui } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { isUserActive } from '../attention/attention-store.js';
import { withoutPatronymic } from '../lib/format.js';
import { chatKeys } from '../chat/chat-keys.js';
import { getOpenConversation } from '../chat/open-conversation.js';
import { threadNotifyAllowed } from '../chat/thread-notify-gate.js';
import { desktopFlashTaskbar, desktopShowPopup, isDesktopShell } from './desktop-bridge.js';

/**
 * Попапы десктоп-оболочки по WS-событию chat.message_sent (ADR-0019): правила
 * тишины — ЗДЕСЬ, в веб-приложении (оболочка — только исполнитель дисплея).
 * Свои сообщения не звенят. Смотрю в открытую беседу (окно на виду, в фокусе,
 * беседа открыта) — ПОЛНАЯ тишина, включая «Важное» (#300, вердикт владельца
 * 15.10; зеркало Slack/Telegram: сообщение и так на экране); «Важное»
 * пробивает только «Заглушено» и «Посмотреть позже». Ответы в трэдах —
 * только наблюдателям/@упомянутым (канон раунда 3, #300). С #650 попапы —
 * единственный канал уведомлений (браузерный opt-in удалён): в оболочке они
 * показываются всегда по этим правилам тишины.
 */
export function notifyDesktopMessage(payload: unknown, queryClient: QueryClient): void {
  if (!isDesktopShell()) return;
  const parsed = chatMessageSentPayloadSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.message) return;
  const { conversationId, urgent, message, mentionedUserIds } = parsed.data;
  const meId = useAuthStore.getState().user?.id ?? null;
  if (message.author.id === meId) return;

  // Модель Telegram (фидбек 08.10) + вердикт 15.10 + модель внимания (#770):
  // тишина, только когда пользователь ДЕЙСТВИТЕЛЬНО смотрит в эту беседу —
  // окно на виду, в фокусе, был ввод за 30 с и беседа открыта на видимой
  // поверхности (карточка не под другой). Отошёл/свернул — сообщение не
  // видно, попап нужен. Попапы копятся до реакции (очередь в оболочке),
  // бейдж считает непрочитанное.
  const looking = isUserActive() && getOpenConversation() === conversationId;
  if (looking) return;

  if (!urgent) {
    const flags = conversationFlags(queryClient, conversationId);
    if (flags?.muted || flags?.snoozed) return;
  }

  // Ответ в трэде — гейт наблюдателя (асинхронный: холодный кэш состояний
  // трэдов догоняется одним запросом; корневые сообщения идут синхронно).
  if (message.threadRootId !== null) {
    void threadNotifyAllowed(
      queryClient,
      meId,
      conversationId,
      message.threadRootId,
      mentionedUserIds,
    ).then((allowed) => {
      if (allowed) showPopup();
    });
    return;
  }
  showPopup();

  function showPopup(): void {
    // Превью: текст сообщения; без текста — метка вложения («Фотография»),
    // попап красит её акцентом (модель Telegram, фидбек 08.10).
    const attachments = message.attachments ?? [];
    const text = stripMentionTokens(message.text).trim();
    let preview: string;
    let previewAttachment = false;
    if (text) {
      preview = text.slice(0, 200);
    } else if (attachments.length > 0) {
      preview = attachmentLabel(attachments, ui.desktop);
      previewAttachment = true;
    } else {
      preview = ui.chat.notificationEmpty;
    }

    void desktopShowPopup({
      id: message.id,
      conversationId,
      // Клик по попапу раскрывает окно треда, если попап об ответе в нём (#300).
      threadRootId: message.threadRootId ?? undefined,
      title: withoutPatronymic(message.author.displayName),
      avatarUrl: message.author.avatarUrl ?? undefined,
      preview,
      previewAttachment,
      urgent,
      canReply: true,
    });
    void desktopFlashTaskbar(urgent);
  }
}

/** Метка вложения для превью попапа: вид носителя + число (как Telegram). */
function attachmentLabel(
  attachments: { kind: string; previewKind?: string; mime: string }[],
  t: typeof ui.desktop,
): string {
  const first = attachments[0];
  if (!first) return t.attachmentFile;
  const mime = first.mime.toLowerCase();
  const label =
    first.kind === 'sticker'
      ? t.attachmentSticker
      : first.previewKind === 'image'
        ? attachments.length > 1
          ? t.attachmentImages
          : t.attachmentImage
        : first.previewKind === 'video'
          ? t.attachmentVideo
          : first.previewKind === 'pdf'
            ? t.attachmentPdf
            : first.previewKind === 'office'
              ? t.attachmentOffice
              : mime.startsWith('audio/')
                ? t.attachmentAudio
                : t.attachmentFile;
  return attachments.length > 1 ? `${label} ×${attachments.length}` : label;
}

/** Mute/snooze беседы из кэша списка (WS-инвалидация несёт свежесть). */
function conversationFlags(
  queryClient: QueryClient,
  conversationId: string,
): { muted: boolean; snoozed: boolean } | null {
  const cache = queryClient.getQueryData<{
    items?: { id: string; muted: boolean; snoozed: boolean }[];
  }>(chatKeys.conversations());
  return cache?.items?.find((c) => c.id === conversationId) ?? null;
}
