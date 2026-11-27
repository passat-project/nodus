import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { Notification } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { Button } from '@nodus/ui/components/button';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { useOpenCard } from '../../../app/shell/use-card-stack.js';
import { PersonAvatar } from '../../../shared/ui/person-avatar.js';
import { useNotifications, useReadNotification } from '../api/notifications-api.js';
import { useNotificationDetailStore } from '../model/detail-store.js';
import { sourceCardOf, openSourceCard } from '../model/open-notification.js';

/**
 * Карточка просмотра уведомления (#100, фидбек владельца 01.10): открывается
 * РОВНО ПОВЕРХ колонки ленты уведомлений на Главной (не на весь экран):
 * метрики компании сверху и дни рождения справа остаются видимыми. Живёт в
 * колонке ленты (home-feed-page), fullscreen-панелью больше не является.
 * Просмотр = прочтение (#244, вердикт владельца 07.10): открытие карточки
 * сразу гасит уведомление — оптимистично, без отдельной кнопки; «Перейти к
 * источнику» — осознанный переход к оригиналу. Esc и крестик закрывают.
 */
export function NotificationReader() {
  const notificationId = useNotificationDetailStore((s) => s.notificationId);
  const close = useNotificationDetailStore((s) => s.close);
  const { data, isLoading } = useNotifications('all');

  // Guard: запись исчезла из журнала (ретеншн/пагинация) — карточка
  // закрывается сама. Оптимистичное гашение не закрывает: кэш-история
  // ('all') не фильтруется (applyGone).
  useEffect(() => {
    if (
      notificationId !== null &&
      !isLoading &&
      data &&
      !data.items.some((n) => n.id === notificationId)
    ) {
      close();
    }
  }, [notificationId, data, isLoading, close]);

  useEffect(() => {
    if (notificationId === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notificationId, close]);

  if (notificationId === null) return null;

  const item = data?.items.find((n) => n.id === notificationId) ?? null;
  return (
    <div
      role="dialog"
      aria-label={ui.notifications.detailTitle}
      className="slider-shadow absolute inset-0 z-30 flex animate-in fade-in zoom-in-95 flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground duration-150"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="min-w-0 truncate text-lg font-semibold text-foreground">
          {item ? ui.notifications.kindTitles[item.kind] : ui.notifications.detailTitle}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={ui.common.close}
          onClick={close}
        >
          <X className="size-4" strokeWidth={1.75} />
        </Button>
      </header>
      {item ? (
        /* Лист ознакомления удалён вместе с ack-механикой (ревизия модели
         * 05.10): важное — обычная карточка «Прочитать» + переход. */
        <PlainBody item={item} onClose={close} />
      ) : isLoading ? (
        <ReaderSkeleton />
      ) : null}
    </div>
  );
}

function ReaderSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-8 py-8">
      <Skeleton className="h-10 w-64 rounded-lg" />
      <Skeleton className="h-4 w-40 rounded-md" />
      <Skeleton className="mt-4 h-32 w-full rounded-[10px]" />
      <Skeleton className="h-4 w-3/4 rounded-md" />
    </div>
  );
}

/** Мета источника: автор (аватар) и момент — единая шапка тела карточки. */
function ReaderMeta({ item }: { item: Notification }) {
  return (
    <div className="flex items-center gap-3">
      <PersonAvatar name={item.actor?.displayName ?? 'N'} className="size-10" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">
          {item.actor?.displayName ?? ui.notifications.detailTitle}
        </div>
        <div className="text-xs text-muted-foreground">
          {new Date(item.createdAt).toLocaleString('ru-RU')}
        </div>
      </div>
    </div>
  );
}

/** Обычное уведомление: текст и переход к источнику. Открытие карточки —
 *  уже прочтение (#244): гашение уходит оптимистично без кнопки, карточка
 *  остаётся открытой (кэш-история 'all' держит запись). */
function PlainBody({ item, onClose }: { item: Notification; onClose: () => void }) {
  const read = useReadNotification();
  const openCard = useOpenCard();
  const source = sourceCardOf(item);

  // Один вызов на запись: ремаунты (StrictMode) и рефечи не дёргают повторно.
  const firedFor = useRef<string | null>(null);
  useEffect(() => {
    if (item.readAt !== null || firedFor.current === item.id) return;
    firedFor.current = item.id;
    read.mutate(item.id);
  }, [item.id, item.readAt, read]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-8 py-6">
        <ReaderMeta item={item} />
        <p className="mt-6 text-[15px] leading-relaxed whitespace-pre-wrap text-foreground/90">
          {item.preview ?? ''}
        </p>
      </div>
      {source && (
        <footer className="shrink-0 border-t border-border">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-end gap-2 px-8 py-3.5">
            <Button
              size="sm"
              onClick={() => {
                onClose();
                // Уведомление об ответе в трэде — источник с окном трэда (#300).
                openSourceCard(openCard, source, item.threadRootId, undefined, item.messageId);
              }}
            >
              {ui.notifications.detailOpenSource}
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
