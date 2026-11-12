import type { QueryClient } from '@tanstack/react-query';
import { chatMessageSentPayloadSchema, stripMentionTokens, ui } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { isUserActive } from '../attention/attention-store.js';
import { isModalLayerOpen } from '../attention/modal-layers.js';
import { withoutPatronymic } from '../lib/format.js';
import { chatKeys } from '../chat/chat-keys.js';
import { getOpenConversation } from '../chat/open-conversation.js';
import { threadNotifyAllowed } from '../chat/thread-notify-gate.js';
import { desktopFlashTaskbar, desktopShowPopup, isDesktopShell } from './desktop-bridge.js';
import { recordPopupDecision, type PopupGateReason } from './popup-diagnostics.js';

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
 *
 * Модальный слой (#809): беседа под просмотрщиком/окном не «открыта» даже при
 * активном вводе — попап приходит (гейт `getOpenConversation`, ADR-0038).
 * Каждое решение гейта и исход доставки пишутся в диагностику (#811).
 */
export function notifyDesktopMessage(payload: unknown, queryClient: QueryClient): void {
  const parsed = chatMessageSentPayloadSchema.safeParse(payload);
  const message = parsed.success ? parsed.data.message : undefined;
  // id для журнала — из сырого payload, даже если схема не сошлась.
  const ids = {
    messageId: message?.id ?? rawId(payload, 'messageId'),
    conversationId: parsed.success ? parsed.data.conversationId : rawId(payload, 'conversationId'),
  };
  if (!isDesktopShell()) {
    record(ids, 'not_shell');
    return;
  }
  if (!parsed.success || !message) {
    record(ids, 'invalid_payload', 'schema');
    return;
  }
  const { conversationId, urgent, mentionedUserIds } = parsed.data;
  // Сужаем один раз: вложенная showPopup не сохраняет narrowing `message`
  // (сообщение схемы опционально).
  const incoming = message;
  const meId = useAuthStore.getState().user?.id ?? null;
  if (incoming.author.id === meId) {
    record(ids, 'own');
    return;
  }

  // Модель Telegram (фидбек 08.10) + вердикт 15.10 + модель внимания (#770):
  // тишина, только когда пользователь ДЕЙСТВИТЕЛЬНО смотрит в эту беседу —
  // окно на виду, в фокусе, был ввод за 30 с и беседа открыта на видимой
  // поверхности (карточка не под другой). Отошёл/свернул — сообщение не
  // видно, попап нужен. Попапы копятся до реакции (очередь в оболочке),
  // бейдж считает непрочитанное.
  const active = isUserActive();
  if (active && !isModalLayerOpen() && getOpenConversation() === conversationId) {
    record(ids, 'looking');
    return;
  }
  const passDetail = !active ? 'inactive' : isModalLayerOpen() ? 'overlay' : 'other_conversation';

  if (!urgent) {
    const flags = conversationFlags(queryClient, conversationId);
    if (flags?.muted) {
      record(ids, 'muted');
      return;
    }
    if (flags?.snoozed) {
      record(ids, 'snoozed');
      return;
    }
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
      else record(ids, 'thread_wait');
    });
    return;
  }
  showPopup();

  function showPopup(): void {
    // Гейт пропустил: пользователь не «смотрит в беседу» — фиксируем почему
    // (иначе успешный попап не отличить от «тишины без следа»).
    record(ids, 'not_active', passDetail);
    // Превью: текст сообщения; без текста — метка вложения («Фотография»),
    // попап красит её акцентом (модель Telegram, фидбек 08.10).
    const attachments = incoming.attachments ?? [];
    const text = stripMentionTokens(incoming.text).trim();
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
      id: incoming.id,
      conversationId,
      // Клик по попапу раскрывает окно треда, если попап об ответе в нём (#300).
      threadRootId: incoming.threadRootId ?? undefined,
      title: withoutPatronymic(incoming.author.displayName),
      avatarUrl: incoming.author.avatarUrl ?? undefined,
      preview,
      previewAttachment,
      urgent,
      canReply: true,
    })
      .then((delivery) => {
        record(ids, delivery === 'sent' ? 'sent' : 'rejected', delivery);
      })
      .catch((error: unknown) => {
        // Tauri `invoke` реджектит СЕРИАЛИЗОВАННЫМ значением `Err`: для
        // `Err("invalid_payload")` это строка, не Error (tauri core.js /
        // ipc/protocol.rs). Код причины обязан доехать до журнала.
        record(
          ids,
          'rejected',
          typeof error === 'string'
            ? error
            : error instanceof Error
              ? error.message
              : 'bridge_error',
        );
      });
    void desktopFlashTaskbar(urgent);
  }
}

function record(
  ids: { messageId: string | null; conversationId: string | null },
  reason: PopupGateReason,
  detail?: string,
): void {
  recordPopupDecision({
    messageId: ids.messageId,
    conversationId: ids.conversationId,
    reason,
    ...(detail === undefined ? {} : { detail }),
  });
}

/** id из сырого payload (только для журнала; никаких имён/текста). */
function rawId(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
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
