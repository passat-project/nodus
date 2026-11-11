import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { Button } from '@nodus/ui/components/button';

/**
 * «Кинозал» видео (#787, решение владельца 11.11.2026): видео открывается
 * не в карточке файла (её шапка — хром документов: версия, «Редактировать»),
 * а на тёмном фоне во весь экран. Плеер вписан по обеим осям с сохранением
 * пропорций (`object-contain`) — поля по краям читаются как кадр кинозала,
 * а не пустая карточка. Сверху тонкая строка: имя, «Скачать», закрыть.
 * Нативные `controls` остаются — это единственная полоса управления.
 *
 * Тема: поверхность намеренно чёрная в обеих темах (как лайтбокс чата,
 * #151/#221) — кинозал не часть темы портала. Портал z-80 — тот же слой,
 * что у лайтбокса. Esc и возврат фокуса — у хоста (`AttachmentViewer`),
 * клик мимо плеера и по шапке гасится здесь.
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
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-[80] bg-black"
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
          key={url}
          src={url}
          controls
          autoFocus
          playsInline
          className="max-h-full max-w-full object-contain"
          aria-label={name}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    </div>,
    document.body,
  );
}
