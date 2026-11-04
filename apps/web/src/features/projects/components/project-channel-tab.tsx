import { useState } from 'react';
import type { ProjectDetail } from '@nodus/contracts';

import { ProjectChat } from './project-chat.js';

/**
 * Вкладка «Канал» (вердикт владельца 07.11.2026): канал проекта — вкладка
 * рабочей зоны; тоггл панели «О канале» — на полосе вкладок карточки, сама
 * панель — ПОЛНОВЫСОТНАЯ колонка-сиблинг карточки (как в задаче и письме,
 * канон «чат — буфер сужений»), а не колонка внутри вкладки. Тред —
 * полновысотное окно рядом с лентой (общий `ChannelView`).
 */
export function ProjectChannelTab({
  project,
  conversationId,
}: {
  project: ProjectDetail;
  /** null — канал ещё не открыт/недоступен (не участник). */
  conversationId: string | null;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 min-w-0 flex-1">
        <ProjectChat
          project={project}
          conversationId={conversationId}
          threadId={threadId}
          onOpenThread={setThreadId}
          onCloseThread={() => setThreadId(null)}
        />
      </div>
    </div>
  );
}
