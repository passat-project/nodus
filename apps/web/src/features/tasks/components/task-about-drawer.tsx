import { ArrowLeft, History, Star, X } from 'lucide-react';
import { memo, useState } from 'react';
import type { TaskDetail, VaultItemType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { useTaskConversation } from '../../../shared/chat/chat-queries.js';
import { ChatProfilePane } from '../../../shared/chat/chat-profile-pane.js';
import { ConversationMembersPanel } from '../../../shared/chat/conversation-members.js';
import { VaultWindow } from '../../../shared/chat/vault-window.js';
import { formatDateTime } from '../../../shared/lib/format.js';

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Star;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border p-3">
      <h4 className="flex items-center gap-2">
        <Icon className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
        <NodeLabel label={title} />
      </h4>
      <div className="mt-2.5 flex flex-col gap-2">{children}</div>
    </section>
  );
}

/**
 * Выдвижная дополнительная панель «О задаче» — ВТАЛКИВАЮЩАЯ колонка справа
 * (не оверлей: чат и композер остаются доступны, вердикт владельца; плавный
 * пуш — transition-[width] на колонке-обёртке в task-card). Это ПАНЕЛЬ
 * БЕСЕДЫ задачи, как у групповых чатов мессенджера (вердикт владельца
 * 16.10, #252): профиль (аватар, «№ N · название», подпись с числом
 * участников, «Звук»/«Копировать ссылку»), строка «Участники» с видом
 * состава (тот же ConversationMembersPanel, состав ведёт задача — без
 * ручных команд), категории вложений с окном категории (VaultWindow), ниже —
 * история задачи. По умолчанию скрыта.
 */
export const TaskAboutDrawer = memo(function TaskAboutDrawer({
  task,
  onClose,
}: {
  task: TaskDetail;
  onClose: () => void;
}) {
  // Вложения задачи = вложения её чата (#252): витрина беседы задачи,
  // строка беседы — тот же кэш by-task, что у обсуждения.
  const conversation = useTaskConversation(task.id).data;
  const conversationId = conversation?.id;
  const [vaultType, setVaultType] = useState<VaultItemType | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [favorite, setFavorite] = useState(false);

  return (
    // Геометрия панели беседы (вердикт владельца 15.09.2026; редизайн
    // 04.11.2026): панель — ПОЛНОВЫСОТНАЯ колонка-сиблинг, её шапка h-10
    // продолжает полосу вкладок правой зоны; верхняя строка (название слева,
    // избранное и крестик У КРАЯ справа) — на высоте полосы, border-b
    // продолжает линию; внутренних перегородок нет, единственная вертикаль —
    // структурная левая граница колонки.
    <aside className="relative flex h-full w-full flex-col border-l border-border bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        {membersOpen ? (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 hover:bg-accent"
            onClick={() => setMembersOpen(false)}
            aria-label={ui.common.back}
            title={ui.common.back}
          >
            <ArrowLeft />
          </Button>
        ) : null}
        <NodeLabel label={membersOpen ? ui.chat.membersPanelTitle : ui.tasks.aboutTask} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setFavorite((v) => !v)}
            aria-label={ui.tasks.favorite}
            className={cn(
              'rounded-lg p-1.5 hover:bg-accent',
              favorite ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            <Star className={cn('size-4.5', favorite && 'fill-current')} />
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="hover:bg-accent"
            onClick={onClose}
            aria-label={ui.common.close}
          >
            <X />
          </Button>
        </div>
      </div>
      {membersOpen && conversation ? (
        <ConversationMembersPanel conversation={conversation} onAddMembers={() => {}} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {conversationId ? (
            // Профиль — по контенту: flex-1 панели беседы прижал бы историю к низу.
            <div className="shrink-0">
              <ChatProfilePane
                conversationId={conversationId}
                conversation={conversation}
                onOpenVaultType={setVaultType}
                onOpenMembers={() => setMembersOpen(true)}
              />
            </div>
          ) : null}

          <Section icon={History} title={ui.tasks.history}>
            <span className="flex justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{ui.tasks.created}</span>
              <span className="shrink-0 font-mono text-label-sm text-muted-foreground">
                {formatDateTime(task.createdAt)}
              </span>
            </span>
            <span className="flex justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{ui.tasks.updated}</span>
              <span className="shrink-0 font-mono text-label-sm text-muted-foreground">
                {formatDateTime(task.updatedAt)}
              </span>
            </span>
          </Section>
        </div>
      )}
      {/* Окно категории витрины — поверх всей панели (канон панели беседы). */}
      {conversationId ? (
        <VaultWindow
          conversationId={conversationId}
          type={vaultType}
          onClose={() => setVaultType(null)}
        />
      ) : null}
    </aside>
  );
});
