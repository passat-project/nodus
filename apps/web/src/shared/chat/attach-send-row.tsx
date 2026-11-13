import { Ellipsis, FilePen, GripVertical, Loader2, Replace, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';
import { Button } from '@nodus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { Input } from '@nodus/ui/components/input';

import { FileTypeIcon } from '../files/file-type-icon.js';
import { formatBytes } from '../lib/format.js';
import { useChatDrafts, type PendingAttachment } from './chat-drafts.js';
import { cancelUpload, removePending, retryUpload } from './composer-files.js';

/**
 * Строка окна отправки вложений (#144): drag-точки сортировки (референс
 * Битрикс24), превью картинки/иконка типа, имя, размер или процент загрузки,
 * повтор при ошибке, крестик снятия. Плоско: токены, без теней.
 *
 * Drag — БЕЗ dnd-kit (вердикт 29.09.2026): PointerSensor dnd-kit на всё время
 * перетаскивания подавляет выделение/каретку в полях ввода (selectionchange →
 * removeTextSelection, жёстко в AbstractPointerSensor) — супер-курсор подписи
 * умирал в момент активации drag. Наша механика: pointerdown на ручке с
 * preventDefault (фокус НЕ уходит из подписи), live-reorder делает хозяин
 * окна по elementsFromPoint; строка сама не двигается transform'ом — нет ни
 * фантомного скролла, ни рамок. Клавиатурная сортировка — задел #146.
 *
 * Меню «⋯» (#146, оба режима окна): «Заменить вложение» (новый файл на
 * место старого) и «Переименовать файл» (инлайн-поле). Имя применяется при
 * отправке/сохранении вместе с составом — серверу уйдёт attachmentRenames.
 */

function ProgressRing({ progress }: { progress: number }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 28 28" className="size-7" aria-hidden>
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        className="text-background/40"
      />
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
        transform="rotate(-90 14 14)"
        className="text-primary-foreground"
      />
    </svg>
  );
}

/** Наложение на миниатюру: кольцо процента пока идёт загрузка, спиннер —
 *  пока сервер обрабатывает уже принятый файл (#717). */
function BusyOverlay({ uploading, progress }: { uploading: boolean; progress: number }) {
  return (
    <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/55">
      {uploading ? (
        <ProgressRing progress={progress} />
      ) : (
        <Loader2 className="size-5 animate-spin text-foreground" strokeWidth={1.75} />
      )}
    </span>
  );
}

export function AttachSendRow({
  scope,
  item,
  dragging,
  actions = false,
  onDragStart,
  onDragMove,
  onDragEnd,
  onPreview,
  onReplace,
  onRenameMode,
}: {
  scope: string;
  item: PendingAttachment;
  dragging: boolean;
  /** Меню «⋯» (замена/переименование) у строки — оба режима окна (#146). */
  actions?: boolean;
  onDragStart: () => void;
  /** Живой реордер: координаты указателя — хозяин окна меняет порядок. */
  onDragMove: (x: number, y: number) => void;
  onDragEnd: () => void;
  /** Клик по миниатюре картинки — просмотр в лайтбоксе поверх окна (#144). */
  onPreview?: () => void;
  /** «Заменить вложение»: хозяин окна открывает выбор файла (#188). */
  onReplace?: () => void;
  /** Поле имени активно: окно гасит супер-курсор на время правки имени
   *  (каретка — в поле), после применения — возвращает в подпись (#188). */
  onRenameMode?: (active: boolean) => void;
}) {
  const uploading = item.status === 'uploading';
  // Тело принято, ответа ещё нет (#717): процент заменяется спиннером —
  // замершие 100% читались как «интерфейс залип».
  const busy = uploading || item.status === 'processing';
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(item.fileName);
  // Расширение НЕ редактируется (вердикт владельца 04.10: не должны случайно
  // сломать) — поле правит только базу, расширение — суффикс поля.
  const [ext, setExt] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Синхронный флаг «закрываем меню ради правки имени»: onCloseAutoFocus
  // меню срабатывает ДО коммита состояния — state тут ещё не виден (#188).
  const renameRequestedRef = useRef(false);
  // Превью картинки: objectURL новой загрузки ИЛИ серверное превью строки
  // правимого сообщения (#188) — файл-иконка для остального.
  const previewSrc = item.objectUrl ?? item.attachment?.thumbnailUrl ?? null;

  // Страховка фокуса: если поле имени смонтировалось без фокуса (иные пути
  // входа), доводим каретку туда кадром позже.
  useEffect(() => {
    if (!renaming) return undefined;
    const timer = window.setTimeout(() => {
      if (document.activeElement === nameInputRef.current) return;
      nameInputRef.current?.focus({ preventScroll: true });
      nameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [renaming]);

  // Применение по ЯВНОМУ действию, не по blur (приёмка 13.11, рецидив):
  // фокус из поля может выдернуть супер-курсор/фокус-ловушка Radix — blur
  // применял имя и «закрывал» поле вне воли пользователя. Клик мимо строки —
  // единственный автоматический путь, и это настоящий pointerdown.
  const applyRef = useRef(applyRename);
  applyRef.current = applyRename;
  useEffect(() => {
    if (!renaming) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`[data-attach-row="${item.localId}"]`)) return;
      applyRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [renaming, item.localId]);

  /** Вход в правку имени: база — в поле, расширение — суффиксом. */
  function startRename() {
    renameRequestedRef.current = true;
    const dot = item.fileName.lastIndexOf('.');
    const base = dot > 0 ? item.fileName.slice(0, dot) : item.fileName;
    const extension = dot > 0 ? item.fileName.slice(dot) : '';
    setDraftName(base);
    setExt(extension);
    setRenaming(true);
    onRenameMode?.(true);
  }

  function stopRename() {
    setRenaming(false);
    onRenameMode?.(false);
  }

  /** Применить имя (Enter/Tab/клик мимо строки): пустая база — откат. */
  function applyRename() {
    if (!renaming) return;
    const base = draftName.trim();
    if (base.length === 0) {
      setDraftName(
        item.fileName.endsWith(ext) ? item.fileName.slice(0, -ext.length) : item.fileName,
      );
      stopRename();
      return;
    }
    const next = base + ext;
    if (next !== item.fileName) {
      useChatDrafts.getState().patchAttachment(scope, item.localId, { fileName: next });
    } else {
      setDraftName(
        item.fileName.endsWith(ext) ? item.fileName.slice(0, -ext.length) : item.fileName,
      );
    }
    stopRename();
  }

  function onHandlePointerDown(event: React.PointerEvent) {
    if (event.button !== 0) return;
    // Фокус остаётся в подписи (супер-курсор живёт и во время drag).
    event.preventDefault();
    onDragStart();
    const move = (ev: PointerEvent) => onDragMove(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      onDragEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  return (
    <li
      data-attach-row={item.localId}
      className={cn(
        'flex items-center gap-2 rounded-lg px-1.5 py-1.5',
        // Тянется — мягкий тон БЕЗ рамки (вердикт 29.09.2026: рамка уродует).
        dragging && 'bg-accent/40',
      )}
    >
      <button
        type="button"
        onPointerDown={onHandlePointerDown}
        aria-label={ui.chat.attachReorder}
        title={ui.chat.attachReorder}
        className="shrink-0 cursor-grab touch-none rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <GripVertical className="size-4" strokeWidth={1.75} />
      </button>
      {previewSrc ? (
        <button
          type="button"
          onClick={onPreview}
          aria-label={ui.chat.attachViewImage}
          title={ui.chat.attachViewImage}
          className="relative size-10 shrink-0 cursor-zoom-in rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
        >
          <span className="block size-full overflow-hidden rounded-lg border border-border">
            <img src={previewSrc} alt="" className="size-full object-cover" />
          </span>
          {busy ? <BusyOverlay uploading={uploading} progress={item.progress} /> : null}
        </button>
      ) : (
        <span className="relative size-10 shrink-0">
          <span className="block size-full overflow-hidden rounded-lg border border-border">
            <span className="flex size-full items-center justify-center bg-muted">
              <FileTypeIcon mime={item.mime} className="size-5" />
            </span>
          </span>
          {busy ? <BusyOverlay uploading={uploading} progress={item.progress} /> : null}
        </span>
      )}
      <span className="min-w-0 flex-1">
        {renaming ? (
          // Инлайн-переименование (#188): правится ТОЛЬКО база имени —
          // расширение суффиксом за полем (не сломать случайно, вердикт
          // владельца 04.10). Enter применяет, Esc откатывает; пока поле
          // живо, супер-курсор окна погашен (каретка здесь).
          <span className="flex items-center gap-1">
            <Input
              ref={nameInputRef}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === 'Tab') {
                  // Tab = «закончил правку»: применяем и возвращаем каретку
                  // в подпись (супер-курсор), фокус дальше не уходит.
                  event.preventDefault();
                  applyRename();
                } else if (event.key === 'Escape') {
                  // Откат имени, НЕ закрытие окна: событие не должно дойти
                  // до Esc-каскада диалога.
                  event.preventDefault();
                  event.stopPropagation();
                  setDraftName(
                    item.fileName.endsWith(ext)
                      ? item.fileName.slice(0, -ext.length)
                      : item.fileName,
                  );
                  stopRename();
                }
              }}
              aria-label={ui.chat.attachRenameField}
              className="h-7 min-w-0 flex-1 rounded-md px-2 text-sm font-medium"
            />
            {ext ? (
              <span className="shrink-0 select-none font-mono text-badge text-muted-foreground tabular-nums">
                {ext}
              </span>
            ) : null}
          </span>
        ) : (
          <>
            <span className="block truncate text-sm font-medium" title={item.fileName}>
              {item.fileName}
            </span>
            <span className="block truncate font-mono text-badge text-muted-foreground tabular-nums">
              {uploading
                ? `${Math.round(item.progress * 100)}%`
                : item.status === 'processing'
                  ? ui.chat.attachProcessing
                  : item.status === 'error'
                    ? ui.chat.uploadFailed
                    : formatBytes(item.size)}
            </span>
          </>
        )}
      </span>
      {item.status === 'error' ? (
        <button
          type="button"
          onClick={() => retryUpload(scope, item.localId)}
          aria-label={ui.chat.uploadRetry}
          title={ui.chat.uploadRetry}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
        >
          <RotateCw className="size-4" strokeWidth={1.75} />
        </button>
      ) : null}
      {actions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground"
              aria-label={ui.chat.attachRowMenu}
              title={ui.chat.attachRowMenu}
            >
              <Ellipsis className="size-4" strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
          {/* Ширина — ПО КОНТЕНТУ, не по триггеру (#188, вердикт владельца
              04.10: дефолт примитива w-trigger-width + min-w-32 переносил
              «Заменить вложение» на две строки — теснота не наш стиль). */}
          <DropdownMenuContent
            align="end"
            className="w-max min-w-40"
            onCloseAutoFocus={(event) => {
              // Меню закрыто ради правки имени: каретку — В ПОЛЕ ИМЕНИ, а не
              // на триггер «⋯» (Radix-возврат блюрил поле сразу после
              // открытия и закрывал правку — вердикт владельца 04.10).
              if (!renameRequestedRef.current) return;
              event.preventDefault();
              renameRequestedRef.current = false;
              requestAnimationFrame(() => {
                nameInputRef.current?.focus({ preventScroll: true });
                nameInputRef.current?.select();
              });
            }}
          >
            <DropdownMenuItem onSelect={() => onReplace?.()}>
              <Replace strokeWidth={1.75} />
              {ui.chat.attachMenuReplace}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => startRename()}>
              <FilePen strokeWidth={1.75} />
              {ui.chat.attachMenuRename}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <button
        type="button"
        onClick={() =>
          busy ? cancelUpload(scope, item.localId) : removePending(scope, item.localId)
        }
        aria-label={busy ? ui.chat.uploadCancel : ui.chat.uploadRemove}
        title={busy ? ui.chat.uploadCancel : ui.chat.uploadRemove}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
      >
        <X className="size-4" strokeWidth={1.75} />
      </button>
    </li>
  );
}
