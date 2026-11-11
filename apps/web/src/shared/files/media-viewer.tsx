import type { ReactNode } from 'react';
import { ui } from '@nodus/contracts';

/**
 * Сцена медиа (#767): flex-центрирование, НЕ grid. Контейнер `grid` +
 * `place-items-center` задаёт неявную auto-строку, её высота считается по
 * intrinsic-размеру самого ребёнка, поэтому `max-h-full` у видео/картинки
 * разрешается против ещё не посчитанной (indefinite) области сетки и молча
 * превращается в `none` — высота остаётся width-driven, и низ ролика вместе
 * с нативной полосой управления уезжает под клип панели (`overflow-hidden`
 * модалки и вкладки). У flex-контейнера высота определена (`size-full` от
 * хоста), процентный `max-h-full` у flex-элемента разрешается против неё и
 * реально ограничивает: замер #767 — 468 px ролика при панели 610 px.
 * `min-h-0` — сцена не раздувается min-content'ом, если хост положит её
 * flex-элементом (та же ловушка автоматического минимума).
 */
function MediaStage({ children }: { children: ReactNode }) {
  return <div className="flex size-full min-h-0 items-center justify-center p-6">{children}</div>;
}

/**
 * Медиа-вьюер (#138): видео/аудио/изображение — нативные элементы браузера
 * (controls), без зависимостей. Изображение из не-галерейных хостов
 * (панель беседы, дровер) открывается тем же вьюером. Полноэкранный контент
 * — БЕЗ скруглений (#151, вердикт владельца 29.09: в углах картинки может
 * быть важная информация); скругления остаются у миниатюр в ленте.
 * Медиа всегда вписывается в панель по ОБЕИМ осям (`max-h-full` +
 * `max-w-full` + `object-contain`, #767): пропорции сохраняются, полоса
 * управления остаётся видимой и в окне просмотра, и в вкладке карточки.
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
      <MediaStage>
        <div className="flex w-full max-w-md flex-col items-center gap-4">
          <span className="text-sm text-muted-foreground">{ui.files.mediaTitle}</span>
          <audio key={url} src={url} controls autoFocus={autoFocus} className="w-full" />
        </div>
      </MediaStage>
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
