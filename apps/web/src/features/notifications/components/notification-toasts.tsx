import { CheckCheck, X, Zap } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ui } from '@nodus/contracts';

import { useConversations } from '../../../shared/chat/chat-queries.js';
import { MentionSnippet } from '../../../shared/chat/mention-chip.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { useNotificationsToastStore } from '../model/toast-store.js';
import { PERSONAL_TOAST_TTL_MS } from '../model/toast-store.js';
import { openNotificationReader, openSourceCard } from '../model/open-notification.js';
import { useNotificationSummary } from '../api/notifications-api.js';
import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { usePauseEscalation } from '../model/use-pause-escalation.js';

/**
 * Тост-контур (#100, вердикты 30.09): стак личного справа-снизу (каждое
 * отдельно, автоскрытие ~8 с, hover — пауза; клик — переход в источник, F1),
 * ОДНА сводная карточка действий «Требуют внимания: N» — персистентная до
 * открытия (F3); фон — тостов не имеет никогда (F4). Поверх карточек
 * (z-[70] — лестница z каркаса). Подавления (mute/snooze/DND/открытый чат)
 * — в shouldToast (toast-store). Клик — сразу к источнику (#300): трэд
 * уведомления раскрывается окном трэда; срочное и безисточниковое — ридер.
 */
export function NotificationToasts() {
  const personal = useNotificationsToastStore((s) => s.personal);
  const actions = useNotificationsToastStore((s) => s.actions);
  const mutedSync = useMutedSnoozeSync();
  void mutedSync;
  // Ф4: эскалация по паузам (idle/смена раздела) — одна мягкая волна ≤1/5мин.
  usePauseEscalation();
  // #616: сводная «Требуют внимания» следует журналу — внимание угасло
  // (письмо открыто/уведомление прочитано в другой вкладке), карточка не
  // висит бесконечно. Тот же ключ сводки, что у заголовка вкладки — один
  // запрос; WS notification.read/dispatch держит кэш свежим.
  useActionsFollowJournal();

  return (
    <div
      aria-live="polite"
      aria-label={ui.notifications.bellLabel}
      className="pointer-events-none fixed right-5 bottom-5 z-[70] flex w-80 flex-col gap-2"
    >
      {actions.count > 0 && <ActionsToast />}
      {personal.map((toast) => (
        <PersonalToastCard
          key={toast.key}
          toastKey={toast.key}
          snapshot={toast.snapshot}
          count={toast.count}
          attempt={toast.attempt}
        />
      ))}
    </div>
  );
}

function PersonalToastCard({
  toastKey,
  snapshot,
  count,
  attempt,
}: {
  toastKey: string;
  snapshot: Parameters<ReturnType<typeof useNotificationsToastStore.getState>['push']>[0];
  count: number;
  attempt: number;
}) {
  const dismiss = useNotificationsToastStore((s) => s.dismissPersonal);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openCard = useOpenCard();

  useEffect(() => {
    const arm = () => {
      timer.current = setTimeout(() => dismiss(toastKey), PERSONAL_TOAST_TTL_MS);
    };
    arm();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [dismiss, toastKey]);

  const urgent = snapshot.priority === 'urgent';
  // Клик — к источнику (F1, #300): у тоста только снимок события, источник
  // чата восстанавливается по conversationId (срочное — лист ознакомления).
  function open() {
    // Уведомление задачи (#252) — сразу карточка задачи, не лист просмотра.
    const card =
      snapshot.priority === 'urgent'
        ? null
        : snapshot.conversationId !== null
          ? ({ kind: 'messenger', id: snapshot.conversationId } as const)
          : snapshot.sourceType === 'task'
            ? ({ kind: 'task', id: snapshot.sourceId } as const)
            : null;
    if (card) {
      openSourceCard(openCard, card, snapshot.threadRootId);
    } else {
      openNotificationReader(snapshot.notificationId);
    }
  }
  return (
    <div
      className="pointer-events-auto node-panel flex items-start gap-3 p-3 shadow-sm"
      onMouseEnter={() => timer.current && clearTimeout(timer.current)}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => dismiss(toastKey), 2500);
      }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
        onClick={() => {
          open();
          dismiss(toastKey);
        }}
      >
        <PersonAvatar name={snapshot.actorName ?? snapshot.preview ?? 'N'} className="size-8" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {urgent && (
              <span className="inline-flex items-center gap-1 rounded-4xl bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                <Zap className="size-3" strokeWidth={1.75} fill="currentColor" />
                {attempt > 0 ? ui.notifications.toastUrgentRepeat : ui.notifications.priorityUrgent}
              </span>
            )}
            {count > 1 && (
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                +{count - 1}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-sm font-medium">
            {snapshot.actorName ?? ui.notifications.kindTitles[snapshot.kind]}
          </span>
          {snapshot.preview && (
            <span className="block truncate text-xs text-muted-foreground">
              <MentionSnippet text={snapshot.preview} />
            </span>
          )}
          {snapshot.conversationTitle && (
            <span className="block truncate text-xs text-muted-foreground">
              {snapshot.conversationTitle}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        aria-label={ui.common.close}
        className="text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => dismiss(toastKey)}
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

function ActionsToast() {
  const actions = useNotificationsToastStore((s) => s.actions);
  const dismiss = useNotificationsToastStore((s) => s.dismissActions);
  const navigate = useNavigate();
  return (
    <div className="pointer-events-auto node-panel flex items-center gap-3 p-3 shadow-sm">
      <span className="grid size-8 place-items-center rounded-full bg-warning/15 text-warning">
        <CheckCheck className="size-4" strokeWidth={1.75} />
      </span>
      <span className="flex-1 text-sm font-medium">
        {ui.notifications.toastActionsSummary}
        <span className="ml-1.5 font-mono text-xs text-muted-foreground tabular-nums">
          {actions.count}
        </span>
      </span>
      <button
        type="button"
        className="text-xs font-medium text-info hover:underline"
        onClick={() => {
          dismiss();
          void navigate({ to: '/home' });
        }}
      >
        {ui.notifications.toastOpen}
      </button>
      <button
        type="button"
        aria-label={ui.common.close}
        className="text-muted-foreground transition-colors hover:text-foreground"
        onClick={dismiss}
      >
        <X className="size-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}

/**
 * Сводная «Требуют внимания» следует журналу (#616): сводка — та же, что у
 * заголовка вкладки (общий ключ кэша, один запрос); внимание угасло —
 * карточка гаснет (локальный счётчик раньше висел бесконечно после
 * прочтения источника в другой вкладке/разделе).
 */
function useActionsFollowJournal(): void {
  const syncWithAttention = useNotificationsToastStore((s) => s.syncWithAttention);
  const { data: summary } = useNotificationSummary();
  useEffect(() => {
    if (summary) syncWithAttention(summary.attention);
  }, [summary, syncWithAttention]);
}

/** Muted/snoozed беседы → тост-гейты (B3/B4): один запрос, тишина на моках. */
function useMutedSnoozeSync(): void {
  const setConversationFlags = useNotificationsToastStore((s) => s.setConversationFlags);
  const { data } = useConversations();
  useEffect(() => {
    if (!data) return;
    const muted = new Set<string>();
    const snoozed = new Set<string>();
    for (const c of data.items) {
      if (c.muted) muted.add(c.id);
      if (c.snoozed) snoozed.add(c.id);
    }
    setConversationFlags({ muted, snoozed });
  }, [data, setConversationFlags]);
}
