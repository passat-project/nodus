import { useEffect, useRef, useState } from 'react';
import type { Config, DocEditor } from '@onlyoffice/doceditor-types';
import { ui, type OfficeSession } from '@nodus/contracts';

import { Spinner } from '@nodus/ui/components/spinner';

import { ViewerFullscreenButton } from './viewer-fullscreen-button.js';

declare global {
  interface Window {
    /** api.js экспортирует ОБЪЕКТ с конструктором: new DocsAPI.DocEditor(...). */
    DocsAPI?: { DocEditor: new (id: string, config: Config) => DocEditor };
  }
}

/** Единственная загрузка api.js на приложение (тот же origin — DS проксируется
 *  корневыми путями: nginx в проде, vite-прокси в dev/песочнице, #138). */
let docsApiPromise: Promise<void> | null = null;

export function loadDocsApi(): Promise<void> {
  if (typeof window !== 'undefined' && window.DocsAPI) return Promise.resolve();
  if (docsApiPromise) return docsApiPromise;
  docsApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/web-apps/apps/api/documents/api.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Ретрай следующей попытки после неудачи (DS перезапускают).
      docsApiPromise = null;
      reject(new Error('DocsAPI failed to load'));
    };
    document.head.appendChild(script);
  });
  return docsApiPromise;
}

/**
 * Хост редактора ONLYOFFICE (#138): сессия собрана и подписана сервером —
 * document/editorConfig передаются ДОСЛОВНО (JWT проверяет целостность),
 * клиент добавляет только отображение (type/width/height) и события.
 * onOutdatedVersion — документ пересохранён: наверх (пересоздание сессии).
 *
 * Стабильность монтажа (#182, репро владельца 02.10): редактор живёт под
 * СВОИМ документ-ключом и режимом — внешние рефечи сессии (ws-инвалидации,
 * переходы dirty→clean DS) обновляют ТОЛЬКО шапку (version из query),
 * редактор не пересоздаётся: DS шлёт changed=false после КАЖДОЙ синхронизации
 * правок (не сохранение версии) — пересоздание на них давало белый экран
 * «перезагрузки страницы» на каждую букву покоя. Пересоздание — только при
 * реальной смене ключа (новая версия по onOutdated) или режима view/edit.
 */
export function OfficeViewer({
  session,
  onOutdated,
  onEngineError,
  onRequestRefresh,
  onFullscreen,
}: {
  session: OfficeSession;
  onOutdated: () => void;
  onEngineError: () => void;
  /** DS 9.4 onRequestRefreshFile: движок просит свежий конфиг сессии —
   * refreshFile обновляет документ БЕЗ перезагрузки редактора (замена
   * тоста «Версия файла была изменена», репро владельца 02.10). */
  onRequestRefresh: () => Promise<OfficeSession | null>;
  /** «На весь экран» во вкладке-файле (у нижнего зума ONLYOFFICE). */
  onFullscreen?: () => void;
}) {
  // УНИКАЛЬНЫЙ id на каждый инстанс: DocsAPI держит реестр редакторов по
  // id плейсхолдера; повторное открытие модалки с тем же id (useId стабилен
  // для позиции дерева) после не успевшего вычиститься destroyEditor
  // молча не стартует — вечная загрузка со второго файла (репро 29.09,
  // владелец: первый csv открывается, дальше все висят).
  const [holderId] = useState(() => `oo-editor-${Math.random().toString(36).slice(2, 10)}`);
  const editorRef = useRef<DocEditor | null>(null);
  const [ready, setReady] = useState(false);
  const handlers = useRef({ onOutdated, onEngineError, onRequestRefresh });
  handlers.current = { onOutdated, onEngineError, onRequestRefresh };
  // Сессия монтажа: редактор создаётся ОДИН раз на монтировку компонента
  // (реакт-ключ над ним — fileId+режим+sessionStale); рефечи того же файла
  // (ws, повторные fetch) приносят новый объект — редактор НЕ пересоздаётся.
  const mountedSession = useRef(session);
  mountedSession.current = session;

  useEffect(() => {
    const initial = mountedSession.current;
    let cancelled = false;
    setReady(false);
    loadDocsApi()
      .then(() => {
        if (cancelled || !window.DocsAPI?.DocEditor) throw new Error('DocsAPI missing');
        // document/editorConfig идут с сервера дословно (JWT целостности);
        // каст — только типы: контракты держат строки, DocEditor-типы — union.
        const config: Config = {
          type: 'desktop',
          width: '100%',
          height: '100%',
          document: initial.document as unknown as Config['document'],
          documentType: initial.documentType,
          editorConfig: initial.editorConfig as unknown as Config['editorConfig'],
          token: initial.token,
          events: {
            onDocumentReady: () => setReady(true),
            onError: (event) => {
              console.error(
                '[office-viewer] onError',
                JSON.stringify(event?.data ?? event).slice(0, 300),
              );
              handlers.current.onEngineError();
            },
            // Легаси (DS < 9.4): документ пересохранён — перемонтируем сессию.
            onOutdatedVersion: () => handlers.current.onOutdated(),
            // DS 9.4: ключ сессии уже использовался для сохранения → движок
            // сам просит свежий конфиг; refreshFile обновляет документ без
            // тоста «Версия файла была изменена» и без перезагрузки.
            onRequestRefreshFile: () => {
              void handlers.current
                .onRequestRefresh()
                .then((fresh) => {
                  if (cancelled || !fresh || !editorRef.current) return;
                  editorRef.current.refreshFile({
                    document: fresh.document as unknown as Config['document'],
                    documentType: fresh.documentType,
                    editorConfig: fresh.editorConfig as unknown as Config['editorConfig'],
                    token: fresh.token,
                  });
                })
                .catch(() => undefined);
            },
          },
        };
        editorRef.current = new window.DocsAPI.DocEditor(holderId, config);
        // Оверлей закрывает только ожидание api.js: конструктор отработал —
        // дальше у DS свой лоадер в плейсхолдере, а его диалоги (кодировка
        // TXT, разделитель CSV) обязаны быть видимы. Детект «появился iframe»
        // ненадёжен (структура DOM api.js различается между сценариями —
        // репро 29.09: диалог CSV оставался под оверлеем).
        setReady(true);
      })
      .catch((error) => {
        console.error('[office-viewer] init failed holder=' + holderId, error);
        if (!cancelled) handlers.current.onEngineError();
      });
    return () => {
      cancelled = true;
      // destroyEditor гасит iframe и каналы ко-эдитинга (утечки WS иначе).
      editorRef.current?.destroyEditor();
      editorRef.current = null;
    };
    // Реакт-ключ над компонентом управляет перемонтированием; сам эффект —
    // только на holderId (стабильность монтажа, #182).
  }, [holderId]);

  return (
    <div className="relative size-full">
      <div id={holderId} className="size-full" />
      {onFullscreen ? (
        <ViewerFullscreenButton onClick={onFullscreen} className="absolute right-3 bottom-9 z-10" />
      ) : null}
      {!ready ? (
        <div className="absolute inset-0 grid place-items-center bg-card">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {ui.files.officePreparing}
          </div>
        </div>
      ) : null}
    </div>
  );
}
