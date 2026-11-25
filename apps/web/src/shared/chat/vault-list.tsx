import { Download, Link2, MessagesSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  FavoriteCard,
  LinkPreview,
  MessageAttachment,
  VaultItem,
  VaultItemType,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { FileTypeIcon } from '../files/file-type-icon.js';
import { formatBytes, formatDateTimeShort, formatVideoDuration } from '../lib/format.js';
import { useJumpStore } from './jump-store.js';
import { VideoPlayGlyph } from './video-play-glyph.js';

/**
 * Рендереры элементов витрины (#211, ревизия 05.10): плитка медиа-сетки
 * (реф Битрикс24), строка вложения, карточка ссылки (домен + адрес + автор;
 * #212 — заголовок/миниатюра готового превью). Общий контекст каждой
 * строки: автор · дата и hover-действия «скачать» / «показать в чате»
 * (jump-store #171). Хозяин — vault-window (окно категории).
 * >300 строк (I5): пять однотипных рендереров одной витрины + карта
 * избранного — общая типизация контекста; дробление на файлы по рендереру
 * разнесло бы единую модель строки.
 */

/** Плитка медиа-сетки: квадратное превью (aspect-square, object-cover; фон
 *  bg-muted — скелетон до загрузки), имя и КОНТЕКСТ ИСТОЧНИКА (автор · дата)
 *  под плиткой; hover-кнопка «показать в чате» поверх превью. */
export function MediaTile({
  name,
  meta,
  src,
  isVideo = false,
  durationMs = null,
  onOpen,
  onJump,
}: {
  name: string;
  meta: string;
  src: string | undefined;
  /** Видео-плитка (#250): play-значок и бейдж длительности на постере. */
  isVideo?: boolean;
  durationMs?: number | null;
  onOpen: () => void;
  onJump: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={name}
      title={name}
      className="group relative flex flex-col gap-1 text-left"
    >
      <span className="relative block aspect-square w-full overflow-hidden rounded-lg bg-muted/60">
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover transition-opacity duration-200 group-hover:opacity-90"
          />
        ) : isVideo ? (
          <span className="absolute inset-0 bg-black/60" />
        ) : null}
        {isVideo ? (
          <>
            {/* Play — по ЦЕНТРУ плитки (уточнение владельца 25.11.2026),
                глиф с точным центрированием; hairline-обводка держит чашку
                на тёмных постерах. */}
            <span className="pointer-events-none absolute inset-0 m-auto grid size-8 place-items-center rounded-full border border-white/20 bg-black/50 text-white">
              <VideoPlayGlyph className="size-4" />
            </span>
            {durationMs !== null ? (
              <span className="pointer-events-none absolute right-1 bottom-1 rounded border border-white/10 bg-black/60 px-1 py-px font-mono text-label-xs text-white tabular-nums">
                {formatVideoDuration(durationMs)}
              </span>
            ) : null}
          </>
        ) : null}
        <span
          role="button"
          tabIndex={0}
          aria-label={ui.chat.showInChat}
          title={ui.chat.showInChat}
          onClick={(event) => {
            event.stopPropagation();
            onJump();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.stopPropagation();
              event.preventDefault();
              onJump();
            }
          }}
          className="absolute right-1 top-1 rounded-md bg-background/85 p-1 text-muted-foreground opacity-0 backdrop-blur-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <MessagesSquare className="size-3.5" strokeWidth={1.75} />
        </span>
      </span>
      <span className="truncate text-xs text-foreground/90">{name}</span>
      <span className="truncate text-label-xs text-muted-foreground tabular-nums">{meta}</span>
    </button>
  );
}

/** Строка вложения (файл/видео/аудио): основное действие строкой
 *  (просмотрщик), справа при ховере — «скачать» и «показать в чате». */
export function VaultRow({
  icon,
  title,
  meta,
  conversationId,
  messageId,
  threadRootId,
  onOpen,
  downloadUrl,
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  conversationId: string;
  messageId: string;
  threadRootId: string | null;
  onOpen?: () => void;
  downloadUrl?: string;
}) {
  const jump = () => useJumpStore.getState().request(conversationId, messageId, threadRootId);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-accent"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/60">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{title}</span>
        <span className="block truncate text-xs text-muted-foreground tabular-nums">{meta}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {downloadUrl ? (
          <a
            href={downloadUrl}
            download
            aria-label={ui.chat.download}
            title={ui.chat.download}
            onClick={(event) => event.stopPropagation()}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Download className="size-3.5" strokeWidth={1.75} />
          </a>
        ) : null}
        <span
          role="button"
          tabIndex={0}
          aria-label={ui.chat.showInChat}
          title={ui.chat.showInChat}
          onClick={(event) => {
            event.stopPropagation();
            jump();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.stopPropagation();
              event.preventDefault();
              jump();
            }
          }}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MessagesSquare className="size-3.5" strokeWidth={1.75} />
        </span>
      </span>
    </button>
  );
}

/** Карточка ссылки (реф Битрикс24 «Ссылки из сообщений»): домен сверху,
 *  адрес строкой, автор · дата; клик — внешнее открытие, hover — прыжок
 *  к источнику. Превью сайта появится с OG-карточками (#212). */
export function VaultLinkCard({
  url,
  preview,
  author,
  createdAt,
  conversationId,
  messageId,
  threadRootId,
}: {
  url: string;
  /** Снимок кэша превью (#212): готовое — заголовок/миниатюра вместо голого
   *  адреса; null/pending/failed — прежний вид (фолбэк, спека). */
  preview: LinkPreview | null;
  author: string;
  createdAt: string;
  conversationId: string;
  messageId: string;
  threadRootId: string | null;
}) {
  const jump = () => useJumpStore.getState().request(conversationId, messageId, threadRootId);
  let domain = url;
  try {
    domain = new URL(url).host;
  } catch {
    /* непарсимый URL — показываем как есть */
  }
  const ready = preview?.status === 'ready';
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:bg-accent"
    >
      {ready && preview.imageUrl ? (
        <img
          src={preview.imageUrl}
          alt={preview.title ?? domain}
          loading="lazy"
          className="h-10 w-10 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted/60">
          <Link2 className="size-4 text-muted-foreground" strokeWidth={1.75} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-muted-foreground">{domain}</span>
        {/* Адрес — токен ссылок проекта (text-info): primary в тёмной теме
            почти белый, акцент терялся (визуальный гейт #211 раунд 2).
            Готовое превью — заголовок вместо адреса (#212, спека витрины). */}
        <span className="block truncate text-sm text-info">
          {ready && preview.title ? preview.title : url}
        </span>
        <span className="block truncate text-xs text-muted-foreground tabular-nums">
          {author} · {formatDateTimeShort(createdAt)}
        </span>
      </span>
      <span
        role="button"
        tabIndex={0}
        aria-label={ui.chat.showInChat}
        title={ui.chat.showInChat}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          jump();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.stopPropagation();
            event.preventDefault();
            jump();
          }
        }}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        <MessagesSquare className="size-3.5" strokeWidth={1.75} />
      </span>
    </a>
  );
}

/** Иконка строки по категории: FileTypeIcon знает video/audio mime. */
export function vaultRowIcon(item: VaultItem): ReactNode {
  return item.type === 'document' || item.type === 'video' || item.type === 'audio' ? (
    <FileTypeIcon mime={item.attachment.mime} className="size-4" />
  ) : null;
}

export function vaultRowMeta(item: VaultItem): string {
  // Дата в строке не нужна: окно категории уже группирует чипами дней.
  return item.type === 'document' || item.type === 'video' || item.type === 'audio'
    ? `${formatBytes(item.attachment.size)} · ${item.author.displayName}`
    : '';
}

/** Человекочитаемая подпись ссылки: домен + усечённый путь (не голый URL). */
export function linkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const label = parsed.host + parsed.pathname.replace(/\/$/, '');
    return label.length > 34 ? `${label.slice(0, 33)}…` : label;
  } catch {
    return url.length > 34 ? `${url.slice(0, 33)}…` : url;
  }
}

export function toViewerTarget(attachment: MessageAttachment) {
  return {
    fileId: attachment.fileId,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    url: attachment.url,
    previewKind: attachment.previewKind,
    pdfUrl: attachment.pdfUrl,
  };
}

export type VaultCategoryType = Exclude<VaultItemType, 'link'>;

/** Метка и пустой список категории — единые для панели и окна. */
export function vaultCategoryLabel(type: VaultItemType): string {
  return type === 'image'
    ? ui.chat.vaultImages
    : type === 'video'
      ? ui.chat.vaultVideos
      : type === 'audio'
        ? ui.chat.vaultAudios
        : type === 'document'
          ? ui.chat.vaultFiles
          : ui.chat.vaultLinks;
}

export function vaultCategoryEmpty(type: VaultItemType): string {
  return type === 'image'
    ? ui.chat.vaultImagesEmpty
    : type === 'video'
      ? ui.chat.vaultVideosEmpty
      : type === 'audio'
        ? ui.chat.vaultAudiosEmpty
        : type === 'document'
          ? ui.chat.vaultFilesEmpty
          : ui.chat.vaultLinksEmpty;
}

/** Экстрактор URL — зеркало серверного link-extractor (https?:// + срез
 *  хвостовой пунктуации): категории «Избранного» строятся из карточек звёзд
 *  (текст оригинала), а не из проекции message_links чужой беседы. */
const URL_RE = /https?:\/\/\S+/g;
const TRAILING = '.,;:!?)]}\'">';
export function extractCardUrls(text: string): string[] {
  const urls: string[] = [];
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0];
    while (url.length > 0 && TRAILING.includes(url[url.length - 1]!)) url = url.slice(0, -1);
    if (url.length > 'https://'.length) urls.push(url);
  }
  return urls;
}

/** Категория вложения карточки — клиентское зеркало vaultKindOf. */
function cardAttachmentKind(attachment: { kind: string; mime: string }) {
  if (attachment.kind === 'image') return 'image' as const;
  if (attachment.kind === 'sticker') return null;
  if (attachment.mime.startsWith('video/')) return 'video' as const;
  if (attachment.mime.startsWith('audio/')) return 'audio' as const;
  return attachment.kind === 'file' ? ('document' as const) : null;
}

/**
 * Элементы категории «Избранного» из карточек звёзд (ревизия 05.10):
 * избранное — закладки в ЧУЖИХ беседах, серверные списки витрины беседы
 * «Избранное» тут врут; карточки уже несут контекст оригинала (прыжок,
 * автор, момент для группировки по дням). Глубина = глубина списка
 * избранного (догрузка карточек — #117), мёртвые карточки — мимо.
 */
export function favoriteVaultItems(cards: FavoriteCard[], type: VaultItemType): VaultItem[] {
  const items: VaultItem[] = [];
  for (const card of cards) {
    if (card.deletedAt || card.obliterated) continue;
    const base = {
      messageId: card.messageId,
      conversationId: card.conversationId,
      threadRootId: card.threadRootId,
      author: card.author,
      createdAt: card.createdAt,
    };
    if (type === 'link') {
      for (const url of extractCardUrls(card.text))
        items.push({
          type,
          ...base,
          url,
          preview: null,
        });
      continue;
    }
    for (const attachment of card.attachments) {
      if (cardAttachmentKind(attachment) !== type) continue;
      items.push({ type, ...base, attachment });
    }
  }
  return items;
}
