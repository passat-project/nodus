import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { OfficeSession } from '@nodus/contracts';

import { Spinner } from '@nodus/ui/components/spinner';

import { api as apiFetch } from '../api-client.js';
import { officeKeys, useOfficeConfig, useOfficeSession } from './api.js';
import { DownloadCard } from './download-card.jsx';
import { MediaViewer } from './media-viewer.jsx';
import { OfficeViewer } from './office-viewer.jsx';
import { PdfViewer } from './pdf-viewer.jsx';
import { TextViewer } from './text-viewer.js';
import { ViewerFullscreenButton } from './viewer-fullscreen-button.js';
import { resolveViewerRoute, type ViewerRoute } from './viewer-registry.js';
import type { ViewerTarget } from './viewer-store.js';

/** Маршрут просмотрщика цели (офис-конфиг сервера + сбой движка) — общий
 *  для тела и шапки модалки: одна точка решения «чем открывать» (#138). */
export function useViewerRoute(
  target: ViewerTarget | null,
  engineFailed: boolean,
): ViewerRoute | null {
  const { data: officeConfig } = useOfficeConfig();
  return useMemo(
    () =>
      target && officeConfig
        ? resolveViewerRoute(target.name, target.mime, target.size, {
            officeEnabled: officeConfig.enabled && !engineFailed,
            maxViewBytes: officeConfig.maxViewBytes,
          })
        : null,
    [target, officeConfig, engineFailed],
  );
}

/**
 * Тело просмотрщика файла (#138 → общий блок #55): маршрут реестра → офис
 * (ONLYOFFICE), PDF (pdf.js), медиа, иначе карточка скачивания; офис при
 * выключенном движке — PDF-копия из конвейера производных (#139). Хосты:
 * модалка `AttachmentViewer` и вкладки карточки письма/конвейер «Новые»
 * (`fit="width"` — страница и скан по ширине панели). Состояние сессии
 * сбрасывается сменой `key` у хоста (новый файл — новый монтаж).
 */
export function FileViewerBody({
  target,
  mode = 'view',
  fit,
  onEngineError,
  onFullscreen,
}: {
  target: ViewerTarget;
  mode?: 'view' | 'edit';
  /** По ширине панели (вкладки, конвейер); без — нативный масштаб модалки. */
  fit?: 'width';
  /** Движок ONLYOFFICE упал — хост прячет «Редактировать». */
  onEngineError?: () => void;
  /** «На весь экран» внутри вкладки-файла (у зума вложения); без — кнопки нет. */
  onFullscreen?: () => void;
}) {
  const queryClient = useQueryClient();
  const [engineFailed, setEngineFailed] = useState(false);
  // Битый/пустой PDF (частый побочный артефакт тестовых данных): вместо
  // тупика «Не удалось открыть документ» — карточка скачивания.
  const [pdfFailed, setPdfFailed] = useState(false);
  const [sessionStale, setSessionStale] = useState(0);
  const route = useViewerRoute(target, engineFailed);
  const sessionQuery = useOfficeSession(target.fileId, mode, route?.kind === 'office');

  if (!route) return <PreparingIndicator />;

  const session = sessionQuery.data ?? null;
  const url = target.url;
  // Fallback ONLYOFFICE (#139): движок выключен/лежит — офисный документ
  // открывается PDF-копией из конвейера производных (битриксов паттерн).
  const pdfFallback = route.reason === 'office_disabled' && target.pdfUrl ? target.pdfUrl : null;
  const download = (reason: 'unsupported' | 'too_large' | 'office_disabled', href = url) => (
    <DownloadCard name={target.name} size={target.size} url={href} reason={reason} />
  );

  if (route.kind === 'office') {
    if (sessionQuery.isPending) return <PreparingIndicator />;
    if (sessionQuery.isError || !session || engineFailed) return download('office_disabled');
    return (
      <OfficeViewer
        // Стабильный монтаж (#182): рефечи сессии не перемонтируют редактор —
        // только смена режима или явное onOutdated (новая версия документа).
        key={`${target.fileId}:${session.mode}:${sessionStale}`}
        session={session}
        onOutdated={() => {
          setSessionStale((n) => n + 1);
          void sessionQuery.refetch();
        }}
        onEngineError={() => {
          setEngineFailed(true);
          onEngineError?.();
        }}
        onRequestRefresh={async () => {
          // DS 9.4 просит свежий конфиг — отдаём актуальную сессию сервера.
          try {
            return await queryClient.fetchQuery({
              queryKey: officeKeys.session(target.fileId, mode),
              queryFn: () =>
                apiFetch<OfficeSession>(`/files/${target.fileId}/office-session?mode=${mode}`),
              staleTime: 0,
            });
          } catch {
            return null;
          }
        }}
        onFullscreen={onFullscreen}
      />
    );
  }
  if (route.kind === 'pdf') {
    return url && !pdfFailed ? (
      <PdfViewer
        url={url}
        fileName={target.name}
        fit={fit}
        onFailed={() => setPdfFailed(true)}
        onFullscreen={onFullscreen}
      />
    ) : (
      download('unsupported', url)
    );
  }
  if (route.kind === 'media') {
    return url ? (
      <div className="relative size-full">
        <MediaViewer url={url} mime={target.mime} name={target.name} fit={fit} autoFocus={!fit} />
        {onFullscreen ? (
          <ViewerFullscreenButton onClick={onFullscreen} className="absolute top-3 right-3 z-10" />
        ) : null}
      </div>
    ) : (
      download('unsupported', null)
    );
  }
  if (route.kind === 'text') {
    return url ? (
      <div className="relative size-full">
        <TextViewer url={url} name={target.name} size={target.size} fit={fit} />
        {onFullscreen ? (
          <ViewerFullscreenButton onClick={onFullscreen} className="absolute top-3 right-3 z-10" />
        ) : null}
      </div>
    ) : (
      download('unsupported', null)
    );
  }
  if (pdfFallback) return <PdfViewer url={pdfFallback} fileName={`${target.name}.pdf`} fit={fit} />;
  return download(route.reason ?? 'unsupported');
}

export function PreparingIndicator() {
  return (
    <div className="grid size-full place-items-center">
      <Spinner className="size-5" />
    </div>
  );
}
