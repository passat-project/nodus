import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
// Воркер как ассет vite: бандлер отдаёт файл и отдаёт URL (Context7 pdfjs-dist
// integration guide — workerSrc обязателен до первого getDocument).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Minus, Plus } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { Button } from '@nodus/ui/components/button';
import { Spinner } from '@nodus/ui/components/spinner';

import { ViewerFullscreenButton } from './viewer-fullscreen-button.js';

/** Тёмный показ PDF (тема портала = тёмный документ, вердикт владельца
 *  28.10): канвас страницы инвертируется CSS-правилом темы в globals.css —
 *  shared не тянет app (направление слоёв). */

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Масштаб рендера страницы (canvas-пикселей на CSS-пиксель; ×2 — чётко на
 *  ретине без заплаток pdfjs-viewer). */
const DEVICE_SCALE = 2;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Ширина страницы модалки при 100% (CSS-пиксели). */
const BASE_WIDTH = 820;

/**
 * Просмотр PDF (pdf.js, #138): лента страниц непрерывным скроллом, зум
 * шагами, номер страницы — по прокрутке. Страницы рендерятся лениво
 * (IntersectionObserver): бокс резервируется габаритами сразу — скролл
 * не прыгает, документ не рендерится целиком (100+ страниц не страшны).
 * `fit="width"` (вкладки карточки письма, конвейер «Новые», #55): 100% —
 * по ширине панели; ресайз панели масштабирует холст CSS-ом без
 * перерисовки (канон ресайза — без работы на каждый кадр).
 */
export function PdfViewer({
  url,
  fileName,
  fit,
  onFailed,
  onFullscreen,
}: {
  url: string;
  fileName: string;
  fit?: 'width';
  /** Документ не открылся (битый файл, 404): хост решает, чем заменить
   *  тупик «Не удалось открыть документ» (например, карточкой скачивания). */
  onFailed?: () => void;
  /** «На весь экран» — в панели зума вложения. */
  onFullscreen?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Колбэк в ref: инлайн-стрелка хоста не должна перезапускать загрузку PDF
  // на каждый рендер (зум/страница).
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pageNumber, setPageNumber] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const task = pdfjs.getDocument({ url });
    task.promise
      .then((loaded) => {
        if (!cancelled) setDoc(loaded);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          onFailedRef.current?.();
        }
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  const zoomIn = useCallback(() => {
    setZoom((z) => ZOOM_STEPS.find((step) => step > z + 0.01) ?? z);
  }, []);
  const zoomOut = useCallback(() => {
    setZoom((z) => [...ZOOM_STEPS].reverse().find((step) => step < z - 0.01) ?? z);
  }, []);

  // Номер страницы по верхней видимой странице.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !doc) return;
    const pages = [...container.querySelectorAll<HTMLElement>('[data-pdf-page]')];
    const onScroll = () => {
      const top = container.scrollTop + 80;
      const visible = pages.find((page) => page.offsetTop + page.offsetHeight > top);
      const index = visible ? Number(visible.dataset.pdfPage) : pages.length;
      setPageNumber(Math.max(1, index || 1));
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [doc]);

  const status = useMemo(() => {
    if (failed) return ui.files.pdfOpenError;
    if (doc) return `${pageNumber} ${ui.files.pdfPageOf} ${doc.numPages}`;
    return ui.files.pdfLoading;
  }, [failed, doc, pageNumber]);

  return (
    <div className="flex size-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 px-4 text-[13px] text-muted-foreground">
        <span className="truncate" title={fileName}>
          {status}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={zoomOut} aria-label={ui.files.zoomOut}>
            <Minus />
          </Button>
          <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon-sm" onClick={zoomIn} aria-label={ui.files.zoomIn}>
            <Plus />
          </Button>
          {onFullscreen ? <ViewerFullscreenButton onClick={onFullscreen} className="ml-1" /> : null}
        </div>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-muted/40 px-4 py-4">
        {failed ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{ui.files.pdfOpenError}</p>
        ) : !doc ? (
          <div className="grid place-items-center py-16">
            <Spinner className="size-5" />
          </div>
        ) : (
          <div className={fit ? 'flex w-full flex-col gap-4' : 'mx-auto flex w-fit flex-col gap-4'}>
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} pageNumber={i + 1} zoom={zoom} fit={fit} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Страница с ленивым рендером: бокс резервируется пропорцией сразу. */
function PdfPage({
  doc,
  pageNumber,
  zoom,
  fit,
}: {
  doc: pdfjs.PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  fit?: 'width';
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(pageNumber <= 3);
  const [aspect, setAspect] = useState(1 / 1.414);

  useEffect(() => {
    const el = canvasRef.current?.closest('[data-pdf-page]') ?? canvasRef.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '600px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask: pdfjs.RenderTask | null = null;
    doc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        setAspect(base.width / base.height);
        const canvas = canvasRef.current;
        if (!canvas) return;
        // По ширине: битмап под текущую ширину бокса (скрытая вкладка — база),
        // дальше холст тянет CSS; иначе — фиксированная ширина модалки.
        const boxWidth = canvas.parentElement?.clientWidth ?? 0;
        const cssWidth = fit ? Math.max(boxWidth, BASE_WIDTH * zoom) : BASE_WIDTH * zoom;
        const viewport = page.getViewport({ scale: (cssWidth / base.width) * DEVICE_SCALE });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = fit ? '100%' : `${cssWidth}px`;
        canvas.style.height = 'auto';
        // v6-контракт рендера: передаём сам canvas (canvasContext — deprecated).
        renderTask = page.render({ canvas, viewport });
        return renderTask.promise;
      })
      .catch(() => {
        /* страница не отрендерилась — пустой бокс остаётся */
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, zoom, visible, fit]);

  return (
    <div
      data-pdf-page={pageNumber}
      className="mx-auto shrink-0 overflow-hidden rounded-[8px] border bg-card shadow-none"
      style={{ aspectRatio: `${aspect}`, ...(fit ? { width: `${zoom * 100}%` } : {}) }}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
