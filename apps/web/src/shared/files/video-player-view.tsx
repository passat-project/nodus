import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { Button } from '@nodus/ui/components/button';

import { handleVideoSeekKey } from './video-seek-keys.js';

/**
 * «Кинозал» видео (#787, решение владельца 11.11.2026): видео открывается
 * не в карточке файла (её шапка — хром документов: версия, «Редактировать»),
 * а во весь экран. Плеер вписан по обеим осям с сохранением пропорций
 * (`object-contain`) — поля по краям читаются как кадр кинозала, а не
 * пустая карточка. Сверху тонкая строка: имя, «Скачать», закрыть.
 * Нативные `controls` остаются — это единственная полоса управления.
 *
 * Фон — полупрозрачное затемнение `black/75` (#790): портал под плеером
 * приглушён, но виден — канон лайтбокса Битрикса (`rgba(0,0,0,.7)`).
 * Портал z-80 — тот же слой, что у лайтбокса. Esc и возврат фокуса — у
 * хоста (`AttachmentViewer`), клик мимо плеера и по шапке гасится здесь.
 *
 * Клавиатура (#1005): фокус ставится на `<video>` при открытии явно —
 * React `autoFocus` для медиаэлементов не работает (`commitMount` фокусирует
 * только button/input/select/textarea/img), без этого ←/→ уходили в
 * интерфейс под плеером. `tabIndex={0}` вдобавок не даёт «вечному курсору»
 * композера утащить фокус из оверлея: он не трогает элементы с tabIndex ≥ 0.
 * ←/→ — свои ±5 с (`handleVideoSeekKey`): нативный шаг Chromium — 1%
 * длительности, на коротком ролике это доли секунды.
 */
export function VideoPlayerView({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  const playerRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // preventScroll — канон программного фокуса (#132): не двигать предков.
    playerRef.current?.focus({ preventScroll: true });
  }, [url]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-[80] bg-black/75"
      // Задник закрывает; клики по плееру и шапке — нет (stopPropagation).
      onClick={onClose}
    >
      <header
        className="absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-2 bg-gradient-to-b from-black/80 to-transparent px-3"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="min-w-0 flex-1 truncate text-sm text-white/90" title={name}>
          {name}
        </p>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="text-white/70 hover:bg-white/10 hover:text-white"
        >
          <a href={url} download={name} aria-label={ui.files.download} title={ui.files.download}>
            <Download />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-white/70 hover:bg-white/10 hover:text-white"
          onClick={onClose}
          aria-label={ui.files.close}
          title={ui.files.close}
        >
          <X />
        </Button>
      </header>
      <div className="flex size-full items-center justify-center p-3 pt-14">
        <video
          ref={playerRef}
          key={url}
          src={url}
          controls
          autoPlay
          preload="auto"
          tabIndex={0}
          playsInline
          className="max-h-full max-w-full object-contain"
          aria-label={name}
          onKeyDown={handleVideoSeekKey}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    </div>,
    document.body,
  );
}
