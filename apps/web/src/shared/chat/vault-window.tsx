import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { FavoriteCard, VaultItem, VaultItemType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { cn } from '@nodus/ui/lib/utils';

import { useInfiniteSentinel } from '../views/use-infinite-sentinel.js';
import { useFrameReady } from '../ui/use-frame-ready.js';
import { DayChip } from './day-chip.js';
import { formatVaultDayLabel } from './message-groups.js';
import {
  MediaTile,
  VaultLinkCard,
  VaultRow,
  favoriteVaultItems,
  toViewerTarget,
  vaultCategoryEmpty,
  vaultCategoryLabel,
  vaultRowIcon,
  vaultRowMeta,
} from './vault-list.js';
import { useConversationVault, vaultItems } from './vault-api.js';
import { ImageLightbox } from './image-lightbox.js';
import { useViewerHost } from '../files/viewer-host.js';
import { useViewerStore, type ViewerTarget } from '../files/viewer-store.js';
import { useJumpStore } from './jump-store.js';

/**
 * Окно категории витрины (ревизия #211 05.10, реф Telegram/Битрикс24): клик
 * по строке категории панели-профиля — поверх ВСЕЙ панели (включая её
 * верхний бар) выезжает вертикальный список превью с разделителями дней.
 * В шапке — только «назад» слева (канон окон поверх панели, крестиков нет).
 * Обёртка смонтирована ПОСТОЯННО (w-0 в покое — закон выдвижных поверхностей:
 * переход с первого кадра и после Ctrl+R), контент ленив на первом открытии
 * и остаётся. Данные: обычная беседа — keyset-страницы API (?type=);
 * «Избранное» (prop cards) — карточки звёзд клиентски (favoriteVaultItems):
 * избранное — закладки в чужих беседах, серверная витрина беседы «Избранное»
 * здесь не подходит.
 */
export function VaultWindow({
  conversationId,
  type,
  cards,
  onClose,
}: {
  conversationId: string;
  /** Открытая категория (null — окно закрыто). */
  type: VaultItemType | null;
  /** Карточный режим («Избранное»): элементы из звёзд, не из API-витрины. */
  cards?: FavoriteCard[] | null;
  onClose: () => void;
}) {
  const openedRef = useRef<VaultItemType | null>(null);
  if (type !== null) openedRef.current = type;
  const ready = useFrameReady();
  const viewer = useViewerHost();
  const opened = openedRef.current;
  // Esc закрывает ОКНО категории, а не карточку/слайдер под ним (#252):
  // document-слушатель срабатывает раньше window-слушателя слайдера, тот
  // пропускает defaultPrevented. Лайтбокс гасит Esc сам (capture), просмотрщик
  // файла поверх — его Esc.
  const isOpen = type !== null;
  useEffect(() => {
    if (!isOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (useViewerStore.getState().target) return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);
  const cardMode = cards !== undefined && cards !== null;
  const query = useConversationVault(conversationId, openedRef.current ?? 'image', null, !cardMode);
  const cardItems = useMemo(
    () => (cardMode && opened ? favoriteVaultItems(cards, opened) : null),
    [cardMode, cards, opened],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useInfiniteSentinel(scrollRef, sentinelRef, {
    hasNextPage: cardMode ? false : query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    onLoadMore: () => void query.fetchNextPage(),
  });

  return (
    <div
      aria-hidden={type === null}
      inert={type === null}
      className="pointer-events-none absolute inset-0 z-10 flex justify-end"
    >
      <div
        className={cn(
          'pointer-events-auto flex h-full min-w-0 flex-col overflow-hidden border-l border-border bg-card transition-[width] duration-200 ease-out',
          type !== null && ready ? 'w-full' : 'w-0',
        )}
      >
        {opened !== null ? (
          <>
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 hover:bg-accent"
                onClick={onClose}
                aria-label={ui.common.back}
                title={ui.common.back}
              >
                <ArrowLeft />
              </Button>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {vaultCategoryLabel(opened)}
              </span>
            </div>
            <VaultWindowBody
              conversationId={conversationId}
              type={opened}
              items={cardItems ?? vaultItems(query)}
              isLoading={cardMode ? false : query.isLoading}
              scrollRef={scrollRef}
              sentinelRef={sentinelRef}
              onOpenFile={(target) => {
                viewer.open(target);
                if (viewer.embedded) onClose();
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Тело окна: группы по дню отправки (DayChip, модель Битрикс24) — картинки
 * сеткой 3 колонки с лайтбоксом, файлы/видео/аудио строками, ссылки
 * карточками. Общий скролл окна, сентинел догрузки у дна.
 */
function VaultWindowBody({
  conversationId,
  type,
  items,
  isLoading,
  scrollRef,
  sentinelRef,
  onOpenFile,
}: {
  conversationId: string;
  type: VaultItemType;
  items: VaultItem[];
  isLoading: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  sentinelRef: RefObject<HTMLDivElement | null>;
  onOpenFile: (target: ViewerTarget) => void;
}) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const groups = useMemo(() => groupByDay(items), [items]);
  const imageItems = useMemo(
    () =>
      items.filter((item): item is Extract<VaultItem, { type: 'image' }> => item.type === 'image'),
    [items],
  );
  const images = imageItems.map((item) => item.attachment);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
      {items.length === 0 && !isLoading ? (
        <div className="flex h-full items-center justify-center">
          <Empty>
            <EmptyTitle>{vaultCategoryEmpty(type)}</EmptyTitle>
          </Empty>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-2">
              <DayChip label={formatVaultDayLabel(group.items[0]!.createdAt)} />
              {type === 'image' ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {group.items.map((item) =>
                    item.type === 'image' ? (
                      <MediaTile
                        key={item.attachment.id}
                        name={item.attachment.name}
                        meta={`${item.author.displayName} · ${formatDay(item.createdAt)}`}
                        src={item.attachment.thumbnailUrl ?? undefined}
                        onOpen={() => setLightbox(images.indexOf(item.attachment))}
                        onJump={() =>
                          useJumpStore
                            .getState()
                            .request(conversationId, item.messageId, item.threadRootId)
                        }
                      />
                    ) : null,
                  )}
                </div>
              ) : type === 'link' ? (
                group.items.map((item) =>
                  item.type === 'link' ? (
                    <VaultLinkCard
                      key={`${item.messageId}:${item.url}`}
                      url={item.url}
                      preview={item.preview}
                      author={item.author.displayName}
                      createdAt={item.createdAt}
                      conversationId={conversationId}
                      messageId={item.messageId}
                      threadRootId={item.threadRootId}
                    />
                  ) : null,
                )
              ) : (
                group.items.flatMap((item) =>
                  item.type === 'image' || item.type === 'link'
                    ? []
                    : [
                        <VaultRow
                          key={item.attachment.id}
                          icon={vaultRowIcon(item)}
                          title={item.attachment.name}
                          meta={vaultRowMeta(item)}
                          downloadUrl={item.attachment.url ?? undefined}
                          conversationId={conversationId}
                          messageId={item.messageId}
                          threadRootId={item.threadRootId}
                          onOpen={() => onOpenFile(toViewerTarget(item.attachment))}
                        />,
                      ],
                )
              )}
            </section>
          ))}
        </div>
      )}
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {lightbox !== null && images.length > 0 ? (
        <ImageLightbox
          images={images}
          index={Math.min(lightbox, images.length - 1)}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}

/** Группировка по дню отправки (UTC-день, ось витрины — новые сверху). */
function groupByDay(items: VaultItem[]): { key: string; items: VaultItem[] }[] {
  const groups: { key: string; items: VaultItem[] }[] = [];
  for (const item of items) {
    const key = item.createdAt.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}

/** Короткая дата плитки (без повторения автора — контекст и так виден). */
function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(iso));
}
