import { useEffect, useState } from 'react';
import type { ConversationListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { useAuthStore } from '../../../shared/auth-store.js';
import { AddMembersDialog } from '../../../shared/chat/conversation-members.js';
import { ChatSidePanel, useChatSidePanel } from '../../../shared/chat/chat-side-panel.js';
import { ChannelView } from '../../../shared/chat/channel-view.js';
import { ConversationPane } from '../../../shared/chat/conversation-pane.js';
import { isNotesConversation } from '../../../shared/chat/conversations.js';
import { NotesPane } from '../../../shared/chat/notes-pane.js';
import { NotesSourceWindow } from '../../../shared/chat/notes-source-window.js';
import type { NotesSourceId } from '../../../shared/chat/notes-sources-pane.js';
import { useConvRoom } from '../../../shared/socket/use-conv-room.js';
import { ConversationBar } from './conversation-bar.js';

/**
 * Рабочая область беседы — ОДИН код для всех хозяев (`MessengerBody`:
 * страница `/chat` и полноэкранная карточка мессенджера; карточки проекта и
 * сотрудника рендерят колонку обсуждения тем же механизмом shared/chat):
 * бар беседы (в колонке ленты), тело (канал с тредами или личная/групповая
 * лента) и правая панель файлов/ссылок беседы.
 *
 * Хранилище открытого треда выбирает хост: страница — search `?thread=`
 * (deep-link), карточка — локальное состояние (чужой маршруту параметр
 * не пишем).
 *
 * #186: колонка панели хостит и вид «Участники» (ровно поверх тоггл-панели,
 * та же геометрия 1:1): стрелка «назад» при открытой панели «О чате», иначе
 * крестик; окно добавления участников — одно на беседу (кнопки в баре и в
 * панели участников).
 */
export function ChatWorkspace({
  conversation,
  threadRootId,
  onOpenThread,
  onCloseThread,
}: {
  conversation: ConversationListItem;
  threadRootId: string | null;
  onOpenThread: (rootId: string) => void;
  onCloseThread: () => void;
}) {
  // Панель беседы (закон: у каждого чата) — хостится рабочей областью;
  // тоггл — кнопка СПРАВА ВВЕРХУ бара беседы (канон кнопки «О задаче»).
  const panel = useChatSidePanel();
  const [membersView, setMembersView] = useState(false);
  const [searchView, setSearchView] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  // Окно-источник «Избранного» (#211 Ф3): клик по источнику в панели —
  // лента, выезжающая справа налево поверх витрины; смена беседы сбрасывает.
  const [notesSource, setNotesSource] = useState<NotesSourceId | null>(null);
  // Смена беседы без ремаунта (карточка мессенджера подменяет верхнюю):
  // виды панели персональны беседе — сбрасываем.
  useEffect(() => {
    setMembersView(false);
    setSearchView(false);
    setAddMembersOpen(false);
    setNotesSource(null);
  }, [conversation.id]);
  // Подписка на комнату беседы (#104): мгновенные события и typing.
  useConvRoom(conversation.id);
  // Витрина «Избранного» (#171): беседа с собой — плоский поток записей и
  // карточек избранного (не обычная лента).
  const meId = useAuthStore((s) => s.user?.id ?? null);
  const notes = isNotesConversation(conversation, meId);

  function closeMembers() {
    // Стрелка «назад»: под видом участников была открыта панель «О чате» —
    // возвращаемся к файлам; иначе крестик сворачивает колонку целиком.
    if (panel.open) {
      setMembersView(false);
    } else {
      setMembersView(false);
      panel.close();
    }
  }

  function closePanelView() {
    // Крестик панели: сворачивает колонку целиком из ЛЮБОГО вида (файлы,
    // поиск standalone) — правка раунда 4: раньше при открытой панели
    // вложений крестик не срабатывал вовсе.
    setSearchView(false);
    panel.close();
  }

  function backFromSearch() {
    // «Назад» из поиска: под ним открыта панель вложений — возвращаемся к
    // ней, колонку не трогаем (канон вида участников).
    setSearchView(false);
  }

  function togglePanel() {
    // Тоггл — про панель «О чате»: из режима поиска возвращает к файлам.
    setSearchView(false);
    panel.toggle();
  }

  const bar = (
    <ConversationBar
      conversation={conversation}
      panelOpen={panel.open}
      onPanelToggle={togglePanel}
      onOpenSearch={() => setSearchView(true)}
      onOpenMembers={() => setMembersView(true)}
      onAddMembers={() => setAddMembersOpen(true)}
    />
  );

  return (
    // Панель беседы — ПОЛНОВЫСОТНЫЙ сиблинг всей рабочей области (вердикт
    // владельца 15.09.2026, рефы Битрикс24): занимает ВЕРХНИЙ БАР тоже, её
    // шапка (название + крестик у края) продолжает бар, тоггл уезжает влево.
    <div className="flex h-full min-w-0 flex-1">
      {conversation.type === 'project_channel' ? (
        // Канал: бар беседы — ВНУТРИ колонки ленты (сжимается вместе с ней
        // при открытии полновысотного окна треда — вердикт 15.09.2026).
        <ChannelView
          conversationId={conversation.id}
          threadRootId={threadRootId}
          onOpenThread={onOpenThread}
          onCloseThread={onCloseThread}
          header={bar}
          threadBarClass="h-14"
        />
      ) : (
        // Колонка чата: overflow-hidden — на узких окнах лента гибнет в 0
        // (пола на странице мессенджера нет, #211 находка), и без обрезки
        // контент бара выезжал поверх панели «О чате» (огрызки без ellipsis).
        // relative — корень окна-источника «Избранного» (ревизия 05.10):
        // оно выезжает от САМОГО ВЕРХА и перекрывает бар беседы (Telegram).
        <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          {bar}
          <div className="flex min-h-0 flex-1">
            {notes ? (
              <NotesPane conversationId={conversation.id} />
            ) : (
              <ConversationPane
                conversationId={conversation.id}
                showAuthor={conversation.type !== 'direct'}
                conversation={conversation}
              />
            )}
          </div>
          {notes ? (
            <NotesSourceWindow
              conversationId={conversation.id}
              source={notesSource}
              onClose={() => setNotesSource(null)}
            />
          ) : null}
        </div>
      )}
      <ChatSidePanel
        conversationId={conversation.id}
        conversation={conversation}
        open={panel.open}
        onClose={closePanelView}
        title={conversation.type === 'project_channel' ? ui.chat.aboutChannel : ui.chat.aboutChat}
        view={membersView ? 'members' : searchView ? 'search' : 'files'}
        onMembersClose={closeMembers}
        onSearchBack={backFromSearch}
        onAddMembers={() => setAddMembersOpen(true)}
        onOpenNotesSource={setNotesSource}
      />
      {addMembersOpen ? (
        <AddMembersDialog conversation={conversation} onClose={() => setAddMembersOpen(false)} />
      ) : null}
    </div>
  );
}
