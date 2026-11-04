import { Download } from 'lucide-react';
import type { MessageAttachment } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@nodus/ui/components/attachment';

import { FileTypeIcon } from '../files/file-type-icon.js';
import { useViewerHost } from '../files/viewer-host.js';
import { formatBytes } from '../lib/format.js';
import { messageSurface } from './message-surface.js';

/**
 * Карточка вложения НА поверхности сообщения (#144, вердикт «как в Битриксе»
 * + #150): flat-карточка на тоне пузыря, РАСТЯНУТА на колонку содержимого
 * (`w-full`) — ширину колонки задаёт блок вложений (`mediaBubbleWidth`),
 * а НЕ текст сообщения (вердикт владельца 29.09: «ширина всего пузыря
 * задаётся карточкой вложения, текст не управляет шириной», механика
 * Telegram-документов: captionw = _maxw − padding). Кнопка скачивания — у
 * САМОГО правого края карточки (= край пузыря), переносов строк нет
 * (`flex-nowrap`). Изображение в карточном списке — с квадратной миниатюрой
 * (механика Telegram для микса «фото+файлы»). Клик: файл → просмотрщик
 * (#138), изображение → лайтбокс (onOpenImage). Скачивание — отдельной
 * кнопкой справа (не качаем всё подряд — боль владельца из спеки #138);
 * при url=null слот зарезервирован невидимой проставкой — карточка не
 * меняет ширину.
 */
export function AttachmentCard({
  attachment,
  mine = false,
  onOpenImage,
}: {
  attachment: MessageAttachment;
  /** Чья поверхность сообщения (пузырь/пост) — тон вторичного текста. */
  mine?: boolean;
  /** Клик по карточке-изображению — открыть лайтбокс на этом вложении. */
  onOpenImage?: () => void;
}) {
  const surface = messageSurface(mine);
  const viewer = useViewerHost();
  const isImage = attachment.kind === 'image';
  const open = () => {
    if (isImage) {
      onOpenImage?.();
      return;
    }
    viewer.open({
      fileId: attachment.fileId,
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      url: attachment.url,
      previewKind: attachment.previewKind,
      pdfUrl: attachment.pdfUrl,
    });
  };
  return (
    <Attachment
      surface="flat"
      /* w-full на колонку вложений (#150): кнопка скачивания прижата к
         правому краю пузыря, как в Битриксе. */
      className="w-full cursor-pointer items-center gap-2"
      role="button"
      tabIndex={0}
      aria-label={attachment.name}
      onClick={open}
      onKeyDown={(event: React.KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
    >
      <AttachmentMedia className="w-6">
        {isImage ? (
          // Мини-превью карточки — только серверная миниатюра (#221):
          // оригинал в ленте не грузится, до готовности — нейтральный фон.
          attachment.thumbnailUrl ? (
            <img
              src={attachment.thumbnailUrl}
              alt=""
              loading="lazy"
              className="aspect-square w-6 rounded-sm object-cover"
            />
          ) : (
            <span className="aspect-square w-6 rounded-sm bg-muted" />
          )
        ) : (
          <FileTypeIcon mime={attachment.mime} className="size-6" />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        {/* Без ch-капа: ширину имени ограничивает колонка вложений
            (`mediaBubbleWidth`, CARD_LIST_W ~48ch имени) — truncate
            достраивает остаток. */}
        <AttachmentTitle title={attachment.name}>{attachment.name}</AttachmentTitle>
        <AttachmentDescription className={`tabular-nums ${surface.stripText}`}>
          {formatBytes(attachment.size)}
        </AttachmentDescription>
      </AttachmentContent>
      {!isImage ? (
        attachment.url ? (
          <AttachmentActions>
            <AttachmentAction
              asChild
              aria-label={ui.chat.download}
              className="text-current hover:bg-current/10 hover:text-current dark:hover:bg-current/10 dark:hover:text-current"
              onClick={(event: React.MouseEvent) => event.stopPropagation()}
            >
              <a href={attachment.url} download={attachment.name}>
                <Download />
              </a>
            </AttachmentAction>
          </AttachmentActions>
        ) : (
          /* Слот кнопки скачивания зарезервирован — карточка не меняет
             ширину, когда url подвязывается позже. */
          <span aria-hidden className="w-7 shrink-0" />
        )
      ) : null}
    </Attachment>
  );
}
