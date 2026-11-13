import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChatMessage, MessageAttachment, Paginated, ReplyPreview } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { api } from '../api-client.js';
import { useAuthStore } from '../auth-store.js';
import { useChatDrafts } from './chat-drafts.js';
import { chatKeys } from './chat-keys.js';
import { composerSendErrorCode, useComposerErrors } from './composer-errors.js';
import { enqueueSend } from './send-queue.js';

/** Оптимистичная отправка (I4): мгновенно в кэш ленты/треда, откат при
 *  ошибке. Ответ в тред дополнительно инкрементирует счётчик корня в кэше
 *  ленты (карточка треда обновляется до ответа сервера). Payload линии A
 *  (#87): вложения (attachmentIds + превью для temp-сообщения), ответ-цитата
 *  (replyToId/quoteText + клиентский снапшот для temp). */
export interface SendChatVars {
  text: string;
  threadRootId?: string | null;
  replyToId?: string | null;
  quoteText?: string | null;
  attachmentIds?: string[];
  /** Переименования файлов в окне отправки (#146): имя окна ≠ имя серверной
   *  записи (загрузка стартовала раньше правки). Уходят в тело отправки —
   *  сервер применяет их в транзакции claim, до DTO/события. */
  attachmentRenames?: Array<{ id: string; name: string }>;
  /** Стикер-отправка (#143): id стикера из пака; превью-вложение — в
   *  attachments (kind='sticker' с метаданными пака). */
  stickerId?: string;
  /** Стикер не съедает черновик композера (набранный текст остаётся). */
  keepDraft?: boolean;
  /** Серверные DTO готовых загрузок — для возврата упавшей отправки в
   *  черновик (#248): имя здесь СЕРВЕРНОЕ, переименование окна восстанавливается
   *  отдельно по attachmentRenames (иначе повтор не увидел бы diff имён). */
  attachments?: MessageAttachment[];
  /** Превью для оптимистичного temp-сообщения: те же DTO с ИМЕНЕМ ОКНА
   *  (#146) — пузырь сразу показывает выбранное пользователем имя. */
  optimisticAttachments?: MessageAttachment[];
  reply?: ReplyPreview | null;
  /** «Важное» (#177): флаг летит в тело отправки и в оптимистичный
   *  temp-пузырь (бордер/чип видны сразу, I4). */
  urgent?: boolean;
  /** Ключ идемпотентности = id оптимистичной записи (#48). Обычно НЕ передают:
   *  mutate генерирует temp id на отправку; явно — в тестах и для повторов
   *  ТОГО ЖЕ логического сообщения (двойной клик/ретрай после потери ответа
   *  сойдутся на сервере в одну строку, client_message_id). */
  tempId?: string;
}

interface SendChatMutationVars extends SendChatVars {
  tempId: string;
}

export function useSendChatMessage(conversationId: string, draftScope?: string) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const mutation = useMutation({
    mutationFn: (vars: SendChatMutationVars) =>
      // Очередь беседы (#243): POST-запросы сериализуются — seq на сервере
      // выдаётся в порядке кликов, лента не переупорядочивается после
      // ответов. Темп уже вставлен onMutate (мгновенность I4 не страдает).
      enqueueSend(conversationId, () =>
        api<ChatMessage>(`/chat/conversations/${conversationId}/messages`, {
          method: 'POST',
          // Идемпотентность (#48): ключ = temp id оптимистичной записи —
          // и повтор той же мутации, и прозрачный refresh внутри api()
          // идут с ОДНИМ ключом (по умолчанию ключ — на вызов api()).
          idempotencyKey: vars.tempId,
          body: {
            text: vars.text,
            attachmentIds: vars.attachmentIds,
            attachmentRenames: vars.attachmentRenames,
            stickerId: vars.stickerId,
            replyToId: vars.replyToId ?? null,
            quoteText: vars.quoteText ?? null,
            threadRootId: vars.threadRootId ?? null,
            urgent: vars.urgent,
          },
        }),
      ),

    onMutate: async (vars) => {
      const listKey = chatKeys.messages(conversationId);
      const threadKey = vars.threadRootId
        ? chatKeys.thread(conversationId, vars.threadRootId)
        : listKey;
      await queryClient.cancelQueries({ queryKey: threadKey });

      const temp: ChatMessage = {
        id: vars.tempId,
        conversationId,
        seq: 0, // плейсхолдер: реальный seq придёт с ответом сервера
        // Связка темпа с серверной записью (#243): Idempotency-Key отправки;
        // WS-эхо и рефечи по этому полю узнают свой темп.
        clientMessageId: vars.tempId,
        author: { id: user?.id ?? '', displayName: user?.displayName ?? '', avatarUrl: null },
        text: vars.text,
        replyToId: vars.replyToId ?? null,
        reply: vars.reply ?? null,
        deletedAt: null,
        pinned: false,
        forwardedFrom: null,
        threadRootId: vars.threadRootId ?? null,
        threadRepliesCount: 0,
        reactions: [],
        attachments: vars.optimisticAttachments ?? vars.attachments ?? [],
        editedAt: null,
        readAt: null,
        readBy: [],
        // Оптимистичный пузырь важного (#177): бордер/чип видны сразу (I4).
        urgent: vars.urgent ?? false,
        mentionedUserIds: [],
        // Свежая отправка: превью нет — скелетон по URL, WS дозреет (#212).
        linkPreview: null,
        createdAt: new Date().toISOString(),
      };

      if (vars.threadRootId) {
        // Ответ виден в треде сразу темпом. Счётчик корня в ленте оптимистично
        // НЕ тикает: его +1 пишет WS-эхо (ws-apply, ровно один раз) — здесь
        // +1, там +1 и дубль доставки из user-комнаты считали одну отправку
        // трижды (#303). Спред old сохраняет границу истории (#307).
        queryClient.setQueryData<Paginated<ChatMessage>>(threadKey, (old) =>
          old ? { ...old, items: [...old.items, temp] } : { items: [temp], nextCursor: null },
        );
      } else {
        queryClient.setQueryData<Paginated<ChatMessage>>(listKey, (old) =>
          old ? { ...old, items: [...old.items, temp] } : { items: [temp], nextCursor: null },
        );
      }
      // Новая попытка отправки гасит инлайн-ошибку предыдущей (#177).
      if (draftScope) useComposerErrors.getState().clear(draftScope);
      return { threadKey, tempId: temp.id };
    },

    onError: (error, vars, context) => {
      // Точечный откат СВОЕГО темпа (#243): restore-снапшот при шквальной
      // отправке затирал темпы соседних запросов и чужие события, уже
      // применённые в кэш между мутацией и ошибкой.
      const listKey = chatKeys.messages(conversationId);
      const threadKey = context?.threadKey;
      if (threadKey && threadKey !== listKey) {
        queryClient.setQueryData<Paginated<ChatMessage>>(threadKey, (old) => {
          if (!old?.items.some((m) => m.id === context?.tempId)) return old;
          return { ...old, items: old.items.filter((m) => m.id !== context?.tempId) };
        });
        // Счётчик корня не откатываем: оптимистичного +1 больше нет (#303),
        // падение отправки до эха счётчик не трогало.
      } else {
        queryClient.setQueryData<Paginated<ChatMessage>>(listKey, (old) =>
          old ? { ...old, items: old.items.filter((m) => m.id !== context?.tempId) } : old,
        );
      }
      // Возврат упавшей отправки в поле (#248; инвариант #124 — потерянного
      // текста нет): состав восстанавливается из переменных мутации. Пустое
      // поле — целиком (текст wire→display с чипами, ответ, молния, вложения
      // не claimed на сервере), занятое следующим набором — упавший текст в
      // начало плоским текстом + вложения. Стикер поле не трогает (#143),
      // но активный ответ упавшей стикер-отправки возвращается (#288).
      if (draftScope && !vars.keepDraft) {
        useChatDrafts.getState().restoreFailedSend(draftScope, {
          wireText: vars.text,
          reply: vars.reply ?? null,
          urgent: vars.urgent ?? false,
          attachments: vars.attachments ?? [],
          attachmentRenames: vars.attachmentRenames,
        });
      } else if (draftScope && vars.reply) {
        useChatDrafts.getState().restoreReply(draftScope, vars.reply);
      }
      // 409 политики важных (#177) — инлайн в композере (рядом с молнией),
      // прочие ошибки — штатный тост. Текст при этом НЕ теряется (#124).
      const inlineCode = composerSendErrorCode(error);
      if (inlineCode && draftScope) {
        useComposerErrors.getState().set(draftScope, inlineCode);
        return;
      }
      toast.error(ui.common.sendError);
    },

    onSuccess: (server, vars, context) => {
      // Черновик уже чист с сабмита (#248, Telegram-модель: поле пусто
      // мгновенно, статус отправки живёт в ленте темпом) — здесь кэш черновика
      // НЕ трогаем: тики подтверждений очереди не должны обнулять текст,
      // набираемый следующим сообщением.
      // Темповая запись заменяется серверной НА МЕСТЕ (лента или тред): при
      // последовательной очереди порядок кликов = порядок ответов, позиции
      // не двигаются. Темп мог уже уйти (WS-эхо по clientMessageId / рефеч
      // с мерджем принесли серверную запись) — тогда не дублируем; запись
      // вовсе отсутствует — вставляем перед хвостом более поздних темпов.
      const key = context?.threadKey ?? chatKeys.messages(conversationId);
      queryClient.setQueryData<Paginated<ChatMessage>>(key, (old) => {
        if (!old) return old;
        let settled = false;
        const items = old.items.map((m) => {
          if (settled) return m;
          if (m.id === context?.tempId) {
            settled = true;
            return server;
          }
          // Темп той же логической отправки (эхо обогнало REST) — заменяем;
          // автор сверяется (ключ уникален в рамках автора, БД).
          if (
            m.seq === 0 &&
            m.clientMessageId === server.clientMessageId &&
            m.author.id === server.author.id
          ) {
            settled = true;
            return server;
          }
          // Серверная версия уже применена (эхо/рефеч) — оставляем её.
          if (m.id === server.id) {
            settled = true;
            return m;
          }
          return m;
        });
        if (!settled) {
          const at = items.findIndex((m) => m.seq === 0);
          items.splice(at === -1 ? items.length : at, 0, server);
        }
        return { ...old, items };
      });
      // МОК-симуляция просмотров (#102 р.2) переехала с отправки на КВИТАНЦИЮ
      // просмотра (use-viewport-read.ts): собеседник «просматривает» видимое
      // по мере прокрутки — отложенный рефеч после собственной квитанции.
    },

    onSettled: () => {
      // Ленту НЕ рефечим (#243): onSuccess уже применил точную серверную
      // запись, WS-событие message_sent покрывает побочные ключи; рефеч на
      // каждую отправку шквала и был источником дрожи. Список бесед
      // (превью/активность) и заряды молнии (#177) — как раньше.
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
      void queryClient.invalidateQueries({ queryKey: chatKeys.urgentPolicy() });
    },
  });

  /** Поле чистится на САБМИТЕ, не по подтверждению (#248, модель Telegram):
   *  черновик уходит из композера синхронно с кликом — на медленном канале
   *  текст не висит ~RTT, а тики подтверждений очереди не обнуляют следующий
   *  набираемый текст; статус отправки живёт в ленте (темп). Ошибка вернёт
   *  состав в поле (onError). Стикер поле не трогает (keepDraft, #143), но
   *  ответ-стикером потребляет активный ответ (#288, канон Telegram):
   *  плашка гаснет синхронно с отправкой, текст остаётся, ошибка вернёт. */
  function takeDraft(vars: SendChatVars): void {
    if (!draftScope) return;
    if (vars.keepDraft) {
      if (vars.replyToId) useChatDrafts.getState().cancelReply(draftScope);
      return;
    }
    useChatDrafts.getState().clear(draftScope);
  }

  /** Отправка с temp id (#48): одна отправка = один temp id = один ключ
   *  идемпотентности на все повторы этого сообщения. */
  function mutate(vars: SendChatVars): void {
    takeDraft(vars);
    mutation.mutate({ ...vars, tempId: vars.tempId ?? crypto.randomUUID() });
  }

  /** То же с исходом вызова (#144): окно отправки вложений держит кнопку
   *  нажатой до ответа и переживает сетевую ошибку с повтором. */
  function mutateAsync(vars: SendChatVars): Promise<ChatMessage> {
    takeDraft(vars);
    return mutation.mutateAsync({ ...vars, tempId: vars.tempId ?? crypto.randomUUID() });
  }

  return { ...mutation, mutate, mutateAsync };
}
