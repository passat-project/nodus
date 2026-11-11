import type { ReactNode } from 'react';
import { ui } from '@nodus/contracts';

/**
 * Сцена медиа — flex, не grid (#767): у ребёнка auto-строки грида
 * процентный `max-height` циклический (строка считается по intrinsic-вкладу
 * элемента, CSS Sizing 3) и высоту не ограничивает — видео рисовалось
 * «по ширине» и вылезало за панель вместе с полосой управления. Flex-
 * контейнер с определённой высотой даёт проценту базу, и медиа ужимается
 * по обеим осям с сохранением пропорций (max-w/max-h у replaced-элемента).
 */
function MediaStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex size-full min-h-0 min-w-0 items-center justify-center p-6">{children}</div>
  );
}

/**
 * Медиа-вьюер (#138): видео/аудио/изображение — нативные элементы браузера
 * (controls), без зависимостей. Изображение из не-галерейных хостов
 * (панель беседы, дровер) открывается тем же вьюером. Полноэкранный контент
 * — БЕЗ скруглений (#151, вердикт владельца 29.09: в углах картинки может
 * быть важная информация); скругления остаются у миниатюр в ленте.
 */
export function MediaViewer({
  url,
  mime,
  name,
  fit,
  autoFocus = true,
}: {
  url: string;
  mime: string;
  name: string;
  /** Изображение по ширине панели со скроллом (скан письма, #55). */
  fit?: 'width';
  /** Фокус плеера: модалка — да, вкладка карточки — нет (не крадёт ввод). */
  autoFocus?: boolean;
}) {
  if (mime.startsWith('video/')) {
    return (
      <MediaStage>
        <video
          key={url}
          src={url}
          controls
          autoFocus={autoFocus}
          playsInline
          className="max-h-full max-w-full object-contain"
          aria-label={name}
        />
      </MediaStage>
    );
  }
  if (mime.startsWith('audio/')) {
    return (
      <div className="grid size-full place-items-center p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-4">
          <span className="text-sm text-muted-foreground">{ui.files.mediaTitle}</span>
          <audio key={url} src={url} controls autoFocus={autoFocus} className="w-full" />
        </div>
      </div>
    );
  }
  if (fit === 'width') {
    return (
      <div className="size-full overflow-auto bg-muted/40 p-4">
        <img
          key={url}
          src={url}
          alt={name}
          className="mx-auto block h-auto w-full max-w-[1200px]"
        />
      </div>
    );
  }
  return (
    <MediaStage>
      <img key={url} src={url} alt={name} className="max-h-full max-w-full object-contain" />
    </MediaStage>
  );
}
