import type { QueryClient } from '@tanstack/react-query';
import type { NotificationSnapshot } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { isUserActive } from '../attention/attention-store.js';
import { isModalLayerOpen } from '../attention/modal-layers.js';
import { chatKeys } from '../chat/chat-keys.js';
import { getOpenConversation } from '../chat/open-conversation.js';
import { desktopFlashTaskbar, desktopShowPopup, isDesktopShell } from './desktop-bridge.js';
import { notifyDesktopLetter } from './letter-popup.js';

/**
 * Попапы оболочки из ЖУРНАЛА уведомлений (#880): kinds, у которых НЕТ живого
 * попапа из `chat.message_sent` (notifyDesktopMessage). Новые сообщения
 * (chat.direct_message/mention/thread_reply/channel_post и urgent attempt=0)
 * сюда НЕ попадают — их показывает живой путь, иначе был бы двойной попап.
 * Здесь закрываются разрывы:
 *  - letter.arrived — письмо (#618, прежний notifyDesktopLetter);
 *  - chat.message_edited — правка (#189): живого пути нет, журнал молчал в
 *    оболочке → уведомление о правке не приходило даже без аватара;
 *  - urgent.message attempt>0 — повтор срочного (#100, ADR-0016 §5): каждые
 *    5 мин до часа, пока не прочитано/не ответили. Дедуп по messageId делает
 *    оболочка (стек): висящий попап не дублируется, закрытый без реакции —
 *    возвращается. Срочный попап статичен до реакции (#867, ADR-0019).
 * Правила тишины чата («смотрю в беседу», mute/snooze) — как у живого пути.
 */
export function notifyDesktopJournal(
  snapshot: NotificationSnapshot,
  attempt: number,
  queryClient: QueryClient,
): void {
  if (!isDesktopShell()) return;
  const meId = useAuthStore.getState().user?.id ?? null;
  if (meId === null || snapshot.userId !== meId) return; // чужие будила

  if (snapshot.kind === 'letter.arrived') {
    notifyDesktopLetter(snapshot);
    return;
  }
  if (snapshot.kind === 'chat.message_edited') {
    showEditPopup(snapshot, queryClient);
    return;
  }
  if (snapshot.kind === 'urgent.message' && attempt > 0) {
    showUrgentRepeat(snapshot);
    return;
  }
  // Прочие kinds: новые сообщения покрыты живым путём; task/action — журнал и
  // колокольчик (попапы задач — отдельный задел, вне скоупа #880).
}

/** Попап о правке: заголовок — вид события, превью — кто и новый текст.
 * Трэд-гейт наблюдателей (threadNotifyAllowed) здесь НЕ применяется — это
 * осознанно: правки сервер шлёт всем участникам беседы с thread_root_id=null
 * (notification-builders.buildInsertsFromEditedEvent, канон #189, уровень
 * беседы), снапшот не несёт трэд-источник. Попап согласован с журналом/
 * колокольчиком (там правка тоже видна всем); гейт наблюдателей — только для
 * НОВЫХ сообщений треда (живой путь notifyDesktopMessage). Правила тишины
 * «смотрю в беседу»/mute/snooze — применяются. */
function showEditPopup(snapshot: NotificationSnapshot, queryClient: QueryClient): void {
  const conversationId = snapshot.conversationId;
  if (!conversationId) return;
  if (isUserActive() && !isModalLayerOpen() && getOpenConversation() === conversationId) return;
  const flags = conversationFlags(queryClient, conversationId);
  if (flags?.muted || flags?.snoozed) return;
  const text = (snapshot.preview ?? '').slice(0, 200);
  const preview = snapshot.actorName ? `${snapshot.actorName}: ${text}` : text;
  void desktopShowPopup({
    // Неймспейс edit: — иначе id=messageId совпал бы с живым попапом того же
    // сообщения и дедуп стека swallowed бы правку, пока оригинал висит (#880,
    // замечание валидатора): «отошёл, собеседник правит» — правка обязана прийти.
    id: `edit:${snapshot.messageId ?? snapshot.notificationId}`,
    conversationId,
    threadRootId: snapshot.threadRootId ?? undefined,
    title: ui.notifications.kindTitles['chat.message_edited'],
    preview,
    urgent: false,
    canReply: true,
  });
  void desktopFlashTaskbar(false);
}

/** Повтор срочного: статичный попап (urgent), критичное мигание таскбара.
 * Дедуп по messageId — в стеке оболочки: висящий не дублируется. */
function showUrgentRepeat(snapshot: NotificationSnapshot): void {
  const conversationId = snapshot.conversationId;
  // Полная тишина при активном просмотре беседы (#300, включая «Важное») —
  // как у живого пути: повтор не всплывает поверх читаемой беседы (#880,
  // замечание валидатора). Mute/snooze срочное пробивает (канон живого пути).
  if (
    conversationId &&
    isUserActive() &&
    !isModalLayerOpen() &&
    getOpenConversation() === conversationId
  ) {
    return;
  }
  void desktopShowPopup({
    id: snapshot.messageId ?? snapshot.notificationId,
    conversationId: conversationId ?? undefined,
    threadRootId: snapshot.threadRootId ?? undefined,
    title: snapshot.conversationTitle ?? ui.notifications.kindTitles['urgent.message'],
    preview: (snapshot.preview ?? '').slice(0, 200),
    urgent: true,
    canReply: true,
  });
  void desktopFlashTaskbar(true);
}

/** Mute/snooze беседы из кэша списка (как в notifyDesktopMessage). */
function conversationFlags(
  queryClient: QueryClient,
  conversationId: string,
): { muted: boolean; snoozed: boolean } | null {
  const cache = queryClient.getQueryData<{
    items?: { id: string; muted: boolean; snoozed: boolean }[];
  }>(chatKeys.conversations());
  return cache?.items?.find((c) => c.id === conversationId) ?? null;
}
