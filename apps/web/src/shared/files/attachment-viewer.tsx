import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, X } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { Button } from '@nodus/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@nodus/ui/components/tooltip';

import { useOfficeSession } from './api.js';
import { FileViewerBody, useViewerRoute } from './file-viewer-body.jsx';
import { useViewerStore } from './viewer-store.js';
import { VideoPlayerView } from './video-player-view.js';

/**
 * Модалка-обёртка просмотрщика вложений (#138): шапка (имя, версия,
 * «Скачать», «Редактировать» по праву) + общее тело `FileViewerBody`
 * (офис → ONLYOFFICE, PDF → pdf.js, медиа → нативно, прочее → скачивание;
 * то же тело — во вкладках карточки письма, #55).
 * Один вьюер на приложение (стор), портал z-[80], Esc/задник закрывают,
 * фокус возвращается источнику. Спека: «как в Битриксе» — просмотр
 * встроенным редактором, правка отдельным режимом.
 *
 * Геометрия окна = канон карточек сущностей (ADR-0009): рама inset-2,
 * правый край у служебной полосы (stripW передаёт app-shell из состояния
 * полосы — общие константы слою shared недоступны), скругление карточки,
 * transition-[right] синхронно с раскрытием полосы.
 *
 * Видео исключение (#787, решение владельца 11.11.2026): открывается в
 * «кинозале» `VideoPlayerView` — тёмный экран с плеером и тонкой строкой
 * (имя, «Скачать», закрыть); шапка карточки с версией и правкой — хром
 * документов, плееру она не нужна.
 */
export function AttachmentViewer({ stripW = 0 }: { stripW?: number }) {
  const target = useViewerStore((s) => s.target);
  const close = useViewerStore((s) => s.close);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [engineFailed, setEngineFailed] = useState(false);

  // Свежесть файловых запросов (#182): после сохранения/закрытия версии
  // подхватываются без F5 — инвалидация обоих режимов сессии цели.
  const invalidateFile = useCallback(() => {
    const fileId = useViewerStore.getState().target?.fileId;
    if (fileId) void queryClient.invalidateQueries({ queryKey: ['files', fileId] });
  }, [queryClient]);
  const closeWithInvalidate = useCallback(() => {
    invalidateFile();
    close();
  }, [close, invalidateFile]);

  // Сброс режима при открытии новой цели.
  useEffect(() => {
    setMode('view');
    setEngineFailed(false);
  }, [target?.fileId]);

  const route = useViewerRoute(target, engineFailed);
  // Та же сессия, что у тела (кэш TanStack Query): версия и право правки.
  const sessionQuery = useOfficeSession(target?.fileId ?? null, mode, route?.kind === 'office');

  const closeOnEsc = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeWithInvalidate();
    },
    [closeWithInvalidate],
  );

  useEffect(() => {
    if (!target) return;
    document.addEventListener('keydown', closeOnEsc);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      document.removeEventListener('keydown', closeOnEsc);
      previous?.focus?.();
    };
  }, [target, closeOnEsc]);

  if (!target || !route) return null;

  // Видео — кинозал (#787): без карточки файла; без ссылки на контент
  // падать в тело с карточкой скачивания (как раньше).
  if (target.mime.startsWith('video/') && target.url) {
    return <VideoPlayerView url={target.url} name={target.name} onClose={closeWithInvalidate} />;
  }

  const session = sessionQuery.data ?? null;
  const canSwitchToEdit = route.kind === 'office' && mode === 'view' && session?.canEdit === true;
  const downloadUrl = target.url;

  return createPortal(
    <div
      className="fixed inset-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-label={ui.files.viewerTitle}
    >
      <div className="absolute inset-0 bg-background/80" onClick={closeWithInvalidate} />
      <div
        className="absolute inset-y-2 left-2 flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xl transition-[right] duration-200"
        style={{ right: stripW + 8 }}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium" title={target.name}>
              {target.name}
            </p>
            {session ? (
              <p className="text-[12px] text-muted-foreground">
                {ui.files.versionLabel} {session.version}
                {session.mode === 'view' ? ` · ${ui.files.readingMode}` : ''}
              </p>
            ) : null}
          </div>
          {canSwitchToEdit ? (
            <Button variant="outline" size="sm" onClick={() => setMode('edit')}>
              <Pencil />
              {ui.files.edit}
            </Button>
          ) : null}
          {downloadUrl ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon-sm" aria-label={ui.files.download}>
                  <a href={downloadUrl} download={target.name}>
                    <Download />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{ui.files.download}</TooltipContent>
            </Tooltip>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={closeWithInvalidate}
            aria-label={ui.files.close}
            autoFocus
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1">
          <FileViewerBody
            key={`${target.fileId}:${mode}`}
            target={target}
            mode={mode}
            onEngineError={() => setEngineFailed(true)}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
