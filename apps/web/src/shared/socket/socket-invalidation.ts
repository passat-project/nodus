import type { QueryClient } from '@tanstack/react-query';
import type { RealtimeEnvelope } from '@nodus/contracts';

import { useAuthStore } from '../auth-store.js';
import { lettersKeys } from '../api/letters-keys.js';
import { notificationsKeys } from '../notifications-keys.js';
import { wasInvalidatedRecently } from '../api/task-invalidate.js';
import { chatKeys } from '../chat/chat-keys.js';
import { conversationRowKeys } from '../chat/conversation-rows.js';
import { cachedConversation } from '../chat/chat-queries.js';
import {
  invalidateConversationLists,
  isConversationListsKey,
} from '../chat/conversation-list-invalidation.js';
import { favoriteKeys } from '../chat/favorites-api.js';
import { stickerKeys } from '../chat/sticker-api.js';
import { vaultKeys } from '../chat/vault-api.js';
import {
  applyAttachmentPreviewEvent,
  applyLinkPreviewEvent,
  applyReadEvent,
  applyReactionEvent,
  applySentMessage,
} from '../chat/ws-apply.js';
import { bumpCommentsOnce, useCommentsLive } from '../tasks/comments-live.js';
import { pushCustomFieldKeys } from './custom-fields-invalidation.js';
import { createEchoBatcher, isOwnEvent, type EchoAwareBatcher } from './echo-batcher.js';
import { pushNodeKindKeys } from './node-kinds-invalidation.js';
import { pushProjectKeys } from './project-invalidation.js';
import { pushTaskKeys } from './task-invalidation.js';
import { pushWorkflowKeys } from './workflow-invalidation.js';

/**
 * Роутер WS-событий → инвалидации (#104: сервер — единственная истина).
 * Раунд 3 («буря рефечей»): (1) message_sent с полным DTO применяется в кэш
 * ЛОКАЛЬНО по seq (ws-apply) — рефеча ленты нет вовсе; (2) остальные события
 * коалесцируются батчером (invalidation-batcher): каждый ключ инвалидируется
 * один раз за окно, список бесед — по медленному ярусу (гистерезис
 * пересортировки). Префикс messages(id) покрывает и трэд-ключи.
 * notification.* (#100): журнал/сводка — быстрый ярус; тосты — через мост
 * notification-bridge (фича регистрирует синк, shared не знает features).
 *
 * Одна правка — один раунд (#1051): эхо собственной мутации не повторяет
 * перезапрос ключей, уже обновлённых по ответу (батчер помнит автора события,
 * `echo-batcher.ts`). Эхо, обгонившее ответ мутации, пройдёт обычным раундом:
 * ответ обычно приходит раньше конвейера событий (опрос outbox — до 50 мс),
 * но гарантией это не является — пропущенное изменение дороже лишнего запроса.
 *
 * Куст бесед — точечно: списки обновляются событием любой беседы, одиночные
 * строки (беседа задачи/письма/проекта в карточке, личка) — только событием
 * своей. Прежде каждое чужое сообщение перечитывало весь куст.
 */
export interface RealtimeInvalidator {
  handle: (envelope: RealtimeEnvelope) => void;
  flush: () => void;
  dispose: () => void;
}

export function createRealtimeInvalidator(queryClient: QueryClient): RealtimeInvalidator {
  const echo = createEchoBatcher((key, mark) => {
    // Своё эхо (#1051): мутация уже перезапросила ключ по ответу — второй
    // раунд той же волны не нужен. Гасится ТОЛЬКО эхо текущего пользователя:
    // правка коллеги по тому же ключу в эти же 2 секунды проходит. Событие без
    // автора (старый gateway, системный таймер) не гасим.
    if (mark?.ownOnly && wasInvalidatedRecently(key)) return;
    // Куст бесед — списками; целиком — когда меняется сам куст (из меня
    // исключили, у меня сменилась роль): устареть обязаны и одиночные строки.
    if (isConversationListsKey(key)) {
      if (mark?.wide) void queryClient.invalidateQueries({ queryKey: key });
      else invalidateConversationLists(queryClient);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: key });
  });

  function push(
    batcher: EchoAwareBatcher,
    conversationId: string | null,
    key: 'messages' | 'states' | 'pins',
  ): void {
    if (!conversationId) return;
    if (key === 'messages') batcher.push(chatKeys.messages(conversationId), 'feed');
    else if (key === 'states') batcher.push(chatKeys.threadStates(conversationId), 'feed');
    else batcher.push(chatKeys.pins(conversationId), 'feed');
  }

  /** Одиночные строки этой беседы в кэше (вкладка чата карточки задачи,
   *  письма, проекта; личка) — по событию своей беседы: значок непрочитанного
   *  и состав участников живые (`conversation-rows.ts`). */
  function pushRows(
    batcher: EchoAwareBatcher,
    conversationId: string | null,
    tier: 'feed' | 'list' = 'list',
  ): void {
    if (!conversationId) return;
    for (const key of conversationRowKeys(queryClient, conversationId)) batcher.push(key, tier);
  }

  /** Событие адресовано МНЕ (исключили, сменили мою роль): куст бесед —
   *  целиком и без гашения, даже если это эхо моего же выхода. */
  function aboutMe(batcher: EchoAwareBatcher, payload: Record<string, unknown>): boolean {
    const userId = typeof payload.userId === 'string' ? payload.userId : null;
    if (userId === null || userId !== useAuthStore.getState().user?.id) return false;
    batcher.push(chatKeys.conversations(), 'feed', { wide: true, force: true });
    return true;
  }

  /** Сообщение беседы задачи → живой счётчик комментариев (#252): задача
   *  беседы — из кэшей списка (строка беседы несёт ссылку на задачу). */
  function bumpTaskComments(payload: Record<string, unknown>, kind: string, by: number): void {
    const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : '';
    const messageId = typeof payload.messageId === 'string' ? payload.messageId : '';
    const taskId = conversationId ? cachedConversation(queryClient, conversationId)?.task?.id : '';
    if (taskId && messageId) bumpCommentsOnce(taskId, `${kind}:${messageId}`, by);
  }

  return {
    handle(envelope: RealtimeEnvelope): void {
      const payload = (envelope.payload ?? {}) as Record<string, unknown>;
      const conversationId =
        typeof payload.conversationId === 'string' ? payload.conversationId : null;
      const batcher = echo.forEvent(envelope.actorId ?? null);

      switch (envelope.type) {
        case 'chat.message_sent': {
          // Локальное применение по seq; дыра/нет DTO — коалесцированный рефеч.
          const applied = applySentMessage(queryClient, payload as never);
          if (!applied) push(batcher, conversationId, 'messages');
          bumpTaskComments(payload, 'sent', 1);
          // Точка «есть новые»/счётчик трэда и превью списка — по окнам. Строку
          // беседы в карточке перечитывает чужое сообщение (моё непрочитанным
          // не считается).
          push(batcher, conversationId, 'states');
          if (!isOwnEvent(envelope.actorId ?? null)) pushRows(batcher, conversationId);
          // Витрина #211: новое сообщение могло принести вложения/ссылки.
          if (conversationId) batcher.push(vaultKeys.all, 'feed');
          if (conversationId) batcher.push(chatKeys.conversations(), 'list');
          return;
        }
        case 'chat.link_preview_ready': {
          // Превью дозрело (#212): патч сообщения на месте (скелетон →
          // карточка без рефетча); витрина «Ссылки» — по окну.
          applyLinkPreviewEvent(queryClient, payload as never);
          if (conversationId) batcher.push(vaultKeys.all, 'feed');
          return;
        }
        case 'chat.attachment_preview_ready': {
          // Фоновая миниатюра готова (#221): патч вложения на месте
          // (заглушка → превью без рефетча); витрина «Картинки» — по окну.
          applyAttachmentPreviewEvent(queryClient, payload as never);
          if (conversationId) batcher.push(vaultKeys.all, 'feed');
          return;
        }
        case 'chat.message_edited':
        case 'chat.message_deleted':
          if (envelope.type === 'chat.message_deleted') bumpTaskComments(payload, 'deleted', -1);
          push(batcher, conversationId, 'messages');
          // Витрина #211: правка меняет состав/ссылки, удаление гасит.
          if (conversationId) batcher.push(vaultKeys.all, 'feed');
          // Карточки избранного — живые ссылки на оригинал (#171): правка
          // отражается в карточке, удаление гасит её в надгробие.
          batcher.push(favoriteKeys.all, 'feed');
          if (conversationId) batcher.push(chatKeys.conversations(), 'list');
          // Правка непрочитанного читается как новое, удаление — минус.
          pushRows(batcher, conversationId);
          return;
        case 'task.comments_counted': {
          // Точное значение после серверного пересчёта (#252) — без рефеча досок.
          if (typeof payload.taskId === 'string' && typeof payload.commentsCount === 'number') {
            useCommentsLive.getState().setExact(payload.taskId, payload.commentsCount);
          }
          return;
        }
        case 'chat.message_read': {
          // Шторм квитанций (аудит #123): чужое прочтение патчит readBy автора
          // ЛОКАЛЬНО (ws-apply) — без рефеча ленты и БЕЗ инвалидации списка
          // бесед/состояний (свой бейдж гасит успех собственного POST /read,
          // точки трэдов — тоже). Нет кэша для патча — прежние инвалидации.
          const applied = applyReadEvent(queryClient, payload as never);
          if (!applied) {
            push(batcher, conversationId, 'messages');
            push(batcher, conversationId, 'states');
          }
          return;
        }
        case 'chat.reaction_added':
        case 'chat.reaction_removed': {
          // Локальный патч реакций (ws-apply, #124): чипы обновляются без
          // рефеча; нет сообщения в кэше — коалесцированный рефеч ленты.
          const applied = applyReactionEvent(
            queryClient,
            payload as never,
            envelope.type === 'chat.reaction_added',
          );
          if (!applied) push(batcher, conversationId, 'messages');
          return;
        }
        case 'chat.thread_created':
          push(batcher, conversationId, 'messages');
          push(batcher, conversationId, 'states');
          // Ответ в треде канала — непрочитанное для участника треда.
          pushRows(batcher, conversationId);
          return;
        case 'chat.message_pinned':
        case 'chat.message_unpinned':
          push(batcher, conversationId, 'messages');
          push(batcher, conversationId, 'pins');
          return;
        case 'chat.conversation_created':
          batcher.push(chatKeys.conversations(), 'list');
          return;
        case 'chat.conversation_updated':
          // #186: название/аватар — у всех участников (список + топбар);
          // подписанный URL аватара нестабилен — только рефеч.
          batcher.push(chatKeys.conversations(), 'list');
          pushRows(batcher, conversationId);
          return;
        case 'chat.member_added':
          batcher.push(chatKeys.conversations(), 'list');
          if (conversationId) batcher.push(chatKeys.members(conversationId), 'feed');
          pushRows(batcher, conversationId, 'feed');
          return;
        case 'chat.member_removed':
        case 'chat.member_role_changed':
          if (aboutMe(batcher, payload)) return;
          batcher.push(chatKeys.conversations(), 'list');
          if (conversationId) batcher.push(chatKeys.members(conversationId), 'feed');
          pushRows(batcher, conversationId, 'feed');
          return;
        case 'chat.attachment_updated': {
          // Новая версия файла из сохранения ONLYOFFICE (#182): лента —
          // снапшотные DTO вложений рефечатся, а файловые ключи (сессия
          // просмотрщика) инвалидируются — версия подхватывается без F5.
          push(batcher, conversationId, 'messages');
          if (typeof payload.fileId === 'string') {
            batcher.push(['files', payload.fileId], 'feed');
          }
          return;
        }
        case 'chat.favorite_added':
          // Личное состояние (#171) + активность: новая звезда поднимает
          // «Избранное» в списке бесед (сервер трогает last_message_at,
          // фидбек приёмки #215) — рефечим список.
          batcher.push(favoriteKeys.all, 'feed');
          batcher.push(chatKeys.conversations(), 'list');
          return;
        case 'chat.favorite_removed':
        case 'chat.favorite_updated':
          // Личное состояние (#171): событие приходит только в свою
          // user-комнату — обновляем витрины и звёзды-индикаторы.
          batcher.push(favoriteKeys.all, 'feed');
          return;
        case 'chat.sticker_pack_created':
        case 'chat.sticker_pack_updated':
        case 'chat.sticker_pack_deleted':
        case 'chat.sticker_added':
        case 'chat.sticker_removed':
        case 'chat.sticker_pack_installed':
        case 'chat.sticker_pack_uninstalled':
          // Стикеры (#318): коллега создал/пополнил/удалил пак (корпоративный —
          // у всех, личный — у владельца и установивших) или набор «моих»
          // сменился с другого устройства — пикер и открытое окно пака.
          batcher.push(stickerKeys.packs(), 'feed');
          if (typeof payload.packId === 'string') {
            batcher.push(stickerKeys.pack(payload.packId), 'feed');
          }
          return;
        case 'notification.dispatch_requested': {
          batcher.push(notificationsKeys.all, 'feed');
          // Приём почты (#56, вердикт владельца 28.10): будильник держателям
          // `correspondence.register` приходит в их user-комнату — очередь
          // «Новые» обновляется сама, без F5 и «пришло через несколько минут».
          const snapshot = payload.snapshot as { kind?: unknown; sourceId?: unknown } | undefined;
          if (snapshot?.kind === 'letter.arrived') {
            batcher.push(lettersKeys.lists(), 'feed');
            if (typeof snapshot.sourceId === 'string') {
              batcher.push(lettersKeys.detail(snapshot.sourceId), 'feed');
            }
          }
          return;
        }
        case 'notification.read':
          batcher.push(notificationsKeys.all, 'feed');
          return;
        default:
          // Живые задачи (#311): коллега сменил стадию/срок/состав — у
          // аудитории задачи деталь и переходы догоняют быстро, доски,
          // журнал и счётчики — по медленному ярусу (одна пересборка на пачку).
          // Каталог «Процессов» (#428): типы/маршруты/стадии — своим роутером.
          // Каталог «Полей» и справочников (#431) — тоже.
          if (envelope.type.startsWith('task.'))
            pushTaskKeys(batcher, queryClient, envelope.type, payload);
          else if (pushCustomFieldKeys(batcher, queryClient, envelope.type, payload)) return;
          else if (pushNodeKindKeys(batcher, queryClient, envelope.type)) return;
          else if (pushProjectKeys(batcher, envelope.type, payload)) return;
          else pushWorkflowKeys(batcher, queryClient, envelope.type, payload);
          return;
      }
    },

    flush: echo.flush,
    dispose: echo.dispose,
  };
}
