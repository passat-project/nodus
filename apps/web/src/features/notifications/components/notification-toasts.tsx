import { CheckCheck, X, Zap } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ui } from '@nodus/contracts';

import { useConversations } from '../../../shared/chat/chat-queries.js';
import { MentionSnippet } from '../../../shared/chat/mention-chip.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { isDesktopShell } from '../../../shared/desktop/desktop-bridge.js';
import { useNotificationsToastStore } from '../model/toast-store.js';
import { PERSONAL_TOAST_TTL_MS } from '../model/toast-store.js';
import {
  openNotificationReader,
  openSourceCard,
  sourceCardOf,
} from '../model/open-notification.js';
import { useNotificationSummary } from '../api/notifications-api.js';
import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { usePauseEscalation } from '../model/use-pause-escalation.js';

/**
 * Тост-контур (#100, вердикты 30.09; геометрия — #1038): личный стак
 * колонкой ПОД линией топбара СПРАВА. Якорь — сама мягкая рама (компонент
 * смонтирован в app-shell сразу после TopBar): absolute right-4 = px-4
 * топбара (правый край по правой группе иконок при любом --ui-scale),
 * top = calc(3.5rem + 14px) — НИЗ h-14 шапки в том же rem-пространстве
 * плюс ясный зазор, карточка не налезает на линию разделителя. Карточки —
 * вида десктопных попапов
 * (ADR-0019): 360px, зазор 5, предел 3, автоскрытие ~8 с (hover — пауза),
 * клик — переход в источник (F1). ОДНА сводная карточка действий «Требуют
 * внимания: N» — персистентная до открытия (F3), той же колонкой. Низкий
 * приоритет — тостов не имеет никогда (F4). Поверх карточек (z-[70]).
 * Подавления (mute/snooze/DND/открытый чат) — в shouldToast (toast-store).
 *
 * В десктоп-оболочке компонент не рендерится ВООБЩЕ: всплывающий канал один
 * — нативные попапы (use-notification-sink направляет туда же).
 */
export function NotificationToasts() {
  if (isDesktopShell()) return null;
  return <ToastColumn />;
}

function ToastColumn() {
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
      data-notification-toasts
      className="pointer-events-none absolute top-[calc(3.5rem+14px)] right-4 z-[70] flex w-[360px] flex-col gap-[5px]"
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
    // Уведомление задачи (#252) — сразу карточка задачи, не лист просмотра;
    // письмо — карточка письма. Маппинг — общий с лентой (sourceCardOf),
    // чтобы копии не расходились (баг: тост письма уводил в ридер).
    const card = snapshot.priority === 'urgent' ? null : sourceCardOf(snapshot);
    if (card) {
      openSourceCard(openCard, card, snapshot.threadRootId);
    } else {
      openNotificationReader(snapshot.notificationId);
    }
  }
  return (
    // Карточка — вида десктопного попапа (popup-view.tsx): поверхность
    // node-panel (--card + бордюр + радиус поверхностей), аватар задаёт
    // высоту, два слоя текста (заголовок 13 semibold / тело 12 muted),
    // крестик абсолютный у правого верхнего угла.
    <div
      className="node-panel shadow-sm pointer-events-auto relative flex items-start gap-2.5 p-2"
      onMouseEnter={() => timer.current && clearTimeout(timer.current)}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => dismiss(toastKey), 2500);
      }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-left"
        onClick={() => {
          open();
          dismiss(toastKey);
        }}
      >
        <PersonAvatar
          name={snapshot.actorName ?? snapshot.preview ?? 'N'}
          className="size-14 shrink-0"
        />
        <span className="min-w-0 flex-1">
          {/* Отступ под крестик — только у строки заголовка: тело ниже
              крестика и использует всю ширину (канон попапа). */}
          <span className="flex items-center gap-1.5 pr-6">
            <span className="truncate text-[13px] leading-4 font-semibold">
              {snapshot.actorName ?? ui.notifications.kindTitles[snapshot.kind]}
            </span>
            {urgent && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-4xl bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger">
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
          {snapshot.preview && (
            <span className="mt-1 line-clamp-2 text-[12px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
              <MentionSnippet text={snapshot.preview} />
            </span>
          )}
          {snapshot.conversationTitle && (
            <span className="mt-0.5 block truncate text-[12px] leading-4 text-muted-foreground">
              {snapshot.conversationTitle}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        aria-label={ui.common.close}
        className="text-muted-foreground hover:bg-accent hover:text-foreground absolute top-1 right-1 z-10 flex size-5 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100"
        onClick={() => dismiss(toastKey)}
      >
        <X className="size-3.5" strokeWidth={2.6} />
      </button>
    </div>
  );
}

function ActionsToast() {
  const actions = useNotificationsToastStore((s) => s.actions);
  const dismiss = useNotificationsToastStore((s) => s.dismissActions);
  const navigate = useNavigate();
  return (
    <div className="node-panel shadow-sm pointer-events-auto relative flex items-center gap-2.5 p-2">
      <span className="grid size-14 shrink-0 place-items-center rounded-full bg-warning/15 text-warning">
        <CheckCheck className="size-5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] leading-4 font-semibold">
        {ui.notifications.toastActionsSummary}
        <span className="ml-1.5 font-mono text-[12px] text-muted-foreground tabular-nums">
          {actions.count}
        </span>
      </span>
      {/* mr-5 — clearance абсолютного крестика у правого края. */}
      <button
        type="button"
        className="mr-5 text-xs font-medium whitespace-nowrap text-info hover:underline"
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
        className="text-muted-foreground hover:bg-accent hover:text-foreground absolute top-1 right-1 z-10 flex size-5 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100"
        onClick={dismiss}
      >
        <X className="size-3.5" strokeWidth={2.6} />
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
