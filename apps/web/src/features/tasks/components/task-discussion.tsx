import { memo } from 'react';
import { ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';

import { ApiError } from '../../../shared/api-client.js';
import { useTaskConversation } from '../../../shared/chat/chat-queries.js';
import { ConversationPane } from '../../../shared/chat/conversation-pane.js';

/**
 * Обсуждение задачи — ОБЫЧНАЯ беседа мессенджера `type='task'` (канон
 * владельца #252: один движок чата, без параллельного конвейера): та же
 * лента, композер с вложениями/упоминаниями/цитатами, меню сообщения,
 * треды, черновики и realtime, что в мессенджере. Беседа находится или
 * создаётся сервером по задаче; её состав — участники задачи. Руководитель,
 * видящий задачу по оргструктуре, но не участник — получает 404, и вместо
 * ленты видит подсказку (обсуждение — для участников).
 */
export const TaskDiscussion = memo(function TaskDiscussion({ taskId }: { taskId: string }) {
  const { data, error } = useTaskConversation(taskId);

  if (data) {
    return (
      <ConversationPane
        conversationId={data.id}
        conversation={data}
        composerPlaceholder={ui.tasks.addComment}
        emptyLabel={ui.tasks.discussionEmpty}
        // В покое высота h-16 = бару действий слева: верхние линии обоих
        // баров — одна горизонталь (вердикт владельца); при росте текста
        // композер расширяется вверх, как в мессенджере.
        composerClassName="flex min-h-16 flex-col justify-end"
      />
    );
  }
  return (
    <div className="flex h-full min-w-0 flex-1 items-center justify-center chat-wallpaper bg-chat-zone">
      {error ? (
        <Empty>
          <EmptyTitle>
            {error instanceof ApiError && error.status === 404
              ? ui.tasks.discussionMembersOnly
              : ui.common.loadError}
          </EmptyTitle>
        </Empty>
      ) : null}
    </div>
  );
});
