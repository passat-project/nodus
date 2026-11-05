import { ChartColumn, FileText, Image, Paperclip } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Popover, PopoverAnchor, PopoverContent } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import { addFiles } from './composer-files.js';

/** Задержка закрытия при переезде курсора со скрепки на панель (hover-intent,
 *  как у попапа реакций #132). */
const CLOSE_GRACE_MS = 180;

/** Открытие панели закрывает другую открытую (скрепка ↔ реакции). */
let closeActivePanel: (() => void) | null = null;

/**
 * Скрепка композера — модель Telegram (#151, вердикт владельца 29.09):
 * КЛИК по скрепке сразу открывает проводник («Все файлы», без фильтра), а
 * НАВЕДЕНИЕ БЕЗ ЗАЖАТОЙ КНОПКИ МЫШИ (или фокус с клавиатуры) показывает
 * попап выбора типа — «Фото или видео» / «Файл» / «Опрос»-заготовка.
 * Drag-выделение текста панель не открывает: указатель заезжает на кнопку с
 * зажатой кнопкой мыши, `event.buttons !== 0` — это не наведение (#620).
 * Панель закрывается по уходу курсора (grace 180 мс), Esc/внешнему клику;
 * выбор пункта открывает
 * соответствующий input и закрывает панель. Скрытые input'ы ВСЕГДА в DOM
 * (контракт e2e: setInputFiles в скрытые инпуты напрямую).
 *
 * Геометрия попапа — вердикты 24.09 (#91): радиус КАК у островка
 * (rounded-2xl), левый край по СКРУГЛЕНИЮ островка (alignOffset =
 * островок.left − скрепка.left), низ ВЫШЕ островка целиком (sideOffset от
 * верха островка, меню не пересекает область ввода). Замеры — при открытии.
 */
export function ComposerClipMenu({
  draftKey,
  islandRef,
  align,
  disabled = false,
}: {
  draftKey: string;
  islandRef: RefObject<HTMLSpanElement | null>;
  align: string;
  disabled?: boolean;
}) {
  const clipRef = useRef<HTMLButtonElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [sideOffset, setSideOffset] = useState(4);
  const [alignOffset, setAlignOffset] = useState(0);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closePanel = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      if (closeActivePanel === closePanel) closeActivePanel = null;
    },
    [closePanel],
  );

  function scheduleClose() {
    cancelClose();
    closeTimer.current = window.setTimeout(closePanel, CLOSE_GRACE_MS);
  }

  function openPanel() {
    if (disabled) return;
    if (closeActivePanel && closeActivePanel !== closePanel) closeActivePanel();
    closeActivePanel = closePanel;
    cancelClose();
    // Замер геометрии в момент открытия (#91): левый край — по скруглению
    // островка, низ — выше островка целиком.
    if (islandRef.current && clipRef.current) {
      const island = islandRef.current.getBoundingClientRect();
      const clip = clipRef.current.getBoundingClientRect();
      setSideOffset(Math.max(4, Math.round(clip.top - island.top) + 6));
      setAlignOffset(Math.round(island.left - clip.left));
    }
    setOpen(true);
  }

  /** Клик по скрепке — сразу проводник «Все файлы» (модель Telegram). */
  function openFilePicker() {
    closePanel();
    fileInputRef.current?.click();
  }

  function onPickFiles(event: React.ChangeEvent<HTMLInputElement>) {
    addFiles(draftKey, Array.from(event.target.files ?? []));
    event.target.value = '';
  }

  function onPickType(input: HTMLInputElement | null) {
    closePanel();
    input?.click();
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          // Esc/внешний клик закрывают сразу; уход курсора — через scheduleClose.
          if (next) openPanel();
          else closePanel();
        }}
      >
        <PopoverAnchor asChild>
          <Button
            ref={clipRef}
            type="button"
            variant="ghost"
            size="icon"
            className={cn('shrink-0 text-muted-foreground', align)}
            aria-label={ui.chat.attachFile}
            aria-haspopup="menu"
            aria-expanded={open}
            title={ui.chat.attachFile}
            disabled={disabled}
            onMouseEnter={(event) => {
              // Выделение текста: указатель заезжает на скрепку с зажатой
              // кнопкой мыши — это не наведение, панель не открываем (#620).
              if (event.buttons !== 0) return;
              openPanel();
            }}
            onMouseLeave={scheduleClose}
            onFocus={openPanel}
            onBlur={scheduleClose}
            onClick={openFilePicker}
          >
            <Paperclip strokeWidth={1.75} />
          </Button>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          alignOffset={alignOffset}
          sideOffset={sideOffset}
          role="menu"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className="w-56 rounded-2xl p-1"
        >
          {/* Просторные строки меню (gap/padding как в tdesktop): текст и
              значок дышат и оптически выровнены (баг-вердикт 24.09). */}
          <button
            type="button"
            role="menuitem"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
            onClick={() => onPickType(photoInputRef.current)}
          >
            <Image className="size-4" strokeWidth={1.75} />
            {ui.chat.attachPhoto}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
            onClick={() => onPickType(fileInputRef.current)}
          >
            <FileText className="size-4" strokeWidth={1.75} />
            {ui.chat.attachDocument}
          </button>
          {/* Опросы — заготовка без окна (вердикт 24.09): пункт и значок на
              месте, механика придёт со своим треком. */}
          <button
            type="button"
            role="menuitem"
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
            onClick={() => {
              closePanel();
              toast(ui.chat.pollSoon);
            }}
          >
            <ChartColumn className="size-4" strokeWidth={1.75} />
            {ui.chat.attachPoll}
          </button>
        </PopoverContent>
      </Popover>
      {/* Скрытые инпуты ВСЕГДА смонтированы: e2e ставит файлы напрямую в
          input[accept] (chat-attachments-live), клик скрепки/пунктов меню
          только программно их «нажимает». */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={onPickFiles}
        tabIndex={-1}
        aria-hidden
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={onPickFiles}
        tabIndex={-1}
        aria-hidden
      />
    </>
  );
}
