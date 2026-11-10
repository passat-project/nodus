import { Paperclip } from 'lucide-react';
import { useRef, useState, type DOMAttributes, type DragEvent, type ReactNode } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Drop-зона файлов (A1, #87): перетаскивание файлов на область чата —
 * оверлей «Отпустите, чтобы прикрепить» (Discord/Telegram-канон). Guard от
 * классического бага dragleave на детях — счётчик enter/leave (research).
 * Пунктирная рама — разрешённый affordance переноса (исключение канона
 * «пустые состояния без пунктира», как drop-зона канбана).
 * disabled (вердикт 25.09, гейт вложений в live-режиме): зона не активируется
 * вовсе — ни оверлея, ни приёма.
 */

/** Приём файлового драга без своей обёртки (#716): лента монтирует его через
 *  `FeedDropzone`, окно отправки — прямо на контейнер диалога (обёртка стала
 *  бы лишним grid-элементом и сломала бы раскладку окна). */
export function useFileDrop(
  onFiles: (files: File[]) => void,
  disabled = false,
): {
  active: boolean;
  handlers: Pick<
    DOMAttributes<HTMLElement>,
    'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'
  >;
} {
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  function hasFiles(event: DragEvent): boolean {
    if (disabled) return false;
    const types = event.dataTransfer?.types;
    if (!types?.includes('Files')) return false;
    // Драг внутренних <img> (лента/превью): Chromium СИНТЕЗИРУЕТ File из
    // картинки (webp-миниатюра) — внутренний драг маскируется под файловый
    // и прикреплял дубль отправленного (#242). Признак небраузерного файла
    // — отсутствие html/uri в payload: у драга из ОС только Files.
    return !types.includes('text/html') && !types.includes('text/uri-list');
  }

  return {
    active,
    handlers: {
      onDragEnter: (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setActive(true);
      },
      onDragOver: (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (event) => {
        if (!hasFiles(event)) return;
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setActive(false);
        }
      },
      onDrop: (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setActive(false);
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) onFiles(files);
      },
    },
  };
}

/** Оверлей активного драга: в пределах своего контейнера (relative/fixed). */
export function FileDropOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-1.5 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-info/60 bg-background/85"
    >
      <Paperclip className="size-6 text-info" strokeWidth={1.75} />
      <span className="text-sm font-medium text-foreground">{ui.chat.dropToAttach}</span>
    </div>
  );
}

export function FeedDropzone({
  onFiles,
  disabled = false,
  className,
  children,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const drop = useFileDrop(onFiles, disabled);

  return (
    <div className={cn('relative min-h-0 min-w-0', className)} {...drop.handlers}>
      {children}
      <FileDropOverlay active={drop.active} />
    </div>
  );
}
