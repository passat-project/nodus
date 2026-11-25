import { useEffect, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  SHELL_PANEL_HEIGHT,
  ui,
  type DownloadEntry,
  type ShellUpdateState,
} from '@nodus/contracts';

import { shellApi, type UpdateOutcome } from './shell-ipc.js';

const t = ui.desktop;

/** Метка времени записи реестра: день.месяц часы:минуты (язык интерфейса один — ru). */
const finishedAtFmt = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** DOM-id кнопки максимизации — по нему snap-плагин оболочки навешивает
 *  нативный HTMAXBUTTON-оверлей (Win11 Snap Layouts, ADR-0055). Тот же id
 *  будет у кнопки панели портала — контракт имени один на обе страницы. */
const MAXIMIZE_BUTTON_ID = 'portal-window-maximize';

/**
 * Панель безрамочного окна оболочки (ADR-0055, #1038): браузерный верх
 * «навигация … Приложение / Загрузки / кнопки окна». Рисуется страницей
 * (экран подключения; панель портала — следующая фаза), окно управляется
 * командами моста. Высота — контракт `SHELL_PANEL_HEIGHT` (px, без rem:
 * строка панели не масштабируется --ui-scale).
 */
/** База кнопок окна мини-UI = веб-панель портала (#1038): широкая зона 46px,
 *  мягкие углы, тихий hover; закрытие — системный красный Win11 (#C42B1C,
 *  SystemFillColorCritical) с белым глифом. У закрытия свой базовый класс:
 *  два hover:bg-* в одном классе решает CSS-каскад, акцент побеждал бы. */
const WIN_BTN =
  'text-muted-foreground flex h-7 w-[46px] items-center justify-center rounded-md text-[12px] leading-none transition-colors hover:bg-accent hover:text-foreground';
const WIN_BTN_CLOSE =
  'text-muted-foreground flex h-7 w-[46px] items-center justify-center rounded-md text-[12px] leading-none transition-colors hover:bg-[#C42B1C] hover:text-white active:bg-[#B22B26]';

export function ShellPanel() {
  const [maximized, setMaximized] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  // Оверлей перехватывает pointer-события над кнопкой максимизации —
  // :hover страницы не срабатывает; плагин прокидывает вход/выход курсора
  // событиями (Tailwind-классовое :hover их автоматика не зеркалит).
  const [snapHover, setSnapHover] = useState(false);

  useEffect(() => {
    let alive = true;
    const query = () =>
      void shellApi
        .windowIsMaximized()
        .then((m) => {
          if (alive) setMaximized(m);
        })
        .catch(() => undefined);
    query();
    // Состояние меняется и мимо наших кнопок (snap-оверлей, Win+стрелки,
    // контекстное меню панели задач) — resize ловит каждый переход.
    window.addEventListener('resize', query);
    return () => {
      alive = false;
      window.removeEventListener('resize', query);
    };
  }, []);

  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const unsubs: Array<Promise<() => void>> = [
      win.listen('tauri-snap://snap/mouseenter', () => setSnapHover(true)),
      win.listen('tauri-snap://snap/mouseleave', () => setSnapHover(false)),
    ];
    return () => {
      void Promise.all(unsubs).then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);

  return (
    <>
      <header
        className="bg-background border-b fixed inset-x-0 top-0 z-40 flex items-stretch justify-between"
        style={{ height: SHELL_PANEL_HEIGHT }}
      >
        <div className="flex items-center pl-1" aria-hidden="true">
          {/* Кластер навигации: серые неактивные заглушки браузерного верха. */}
          <NavStub glyph="◀" label={t.panelBack} />
          <NavStub glyph="▶" label={t.panelForward} />
          <NavStub glyph="⟳" label={t.panelReload} />
          <NavStub glyph="🔗" label={t.panelCopyAddress} />
        </div>
        {/* Пустое место строки: перетаскивание окна и разворот двойным кликом. */}
        <div
          className="h-full flex-1"
          onPointerDown={(e) => {
            if (e.button === 0) void shellApi.windowStartDragging();
          }}
          onDoubleClick={() => void shellApi.windowToggleMaximize()}
        />
        <div className="flex items-center pr-1">
          <button
            type="button"
            title={t.panelAppMenu}
            aria-label={t.panelAppMenu}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="text-muted-foreground flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground"
          >
            {/* Значок-заглушка Nodus: тёмно-синяя плитка со знаком. */}
            <span className="bg-primary text-primary-foreground flex h-[16px] w-[16px] items-center justify-center rounded-[5px] text-[9px] leading-none font-semibold">
              N
            </span>
          </button>
          {/* «Загрузки» (эпик #1038, раздел 5): реестр последних загрузок
              оболочки с «Показать в папке». */}
          <div className="relative flex">
            <button
              type="button"
              title={t.panelDownloads}
              aria-label={t.panelDownloads}
              aria-haspopup="dialog"
              aria-expanded={downloadsOpen}
              onClick={() => setDownloadsOpen(true)}
              className="text-muted-foreground flex size-7 items-center justify-center rounded-md text-[13px] leading-none transition-colors hover:bg-accent hover:text-foreground"
            >
              ⤓
            </button>
            {downloadsOpen ? <DownloadsPopover onClose={() => setDownloadsOpen(false)} /> : null}
          </div>
          <button
            type="button"
            title={t.panelWindowMinimize}
            aria-label={t.panelWindowMinimize}
            onClick={() => void shellApi.windowMinimize()}
            className={WIN_BTN}
          >
            ─
          </button>
          {/* На Win11 клик по кнопке перехватывает HTMAXBUTTON-оверлей
              snap-плагина (нативные Snap Layouts); собственный обработчик —
              путь Win10, где плагин — no-op. */}
          <button
            type="button"
            id={MAXIMIZE_BUTTON_ID}
            title={maximized ? t.panelWindowRestore : t.panelWindowMaximize}
            aria-label={maximized ? t.panelWindowRestore : t.panelWindowMaximize}
            onClick={() => void shellApi.windowToggleMaximize()}
            className={`${WIN_BTN}${snapHover ? ' bg-accent text-foreground' : ''}`}
          >
            {maximized ? '❐' : '□'}
          </button>
          <button
            type="button"
            title={t.panelWindowClose}
            aria-label={t.panelWindowClose}
            onClick={() => void shellApi.windowClose()}
            className={WIN_BTN_CLOSE}
          >
            ✕
          </button>
        </div>
      </header>
      {menuOpen ? <AppMenuDialog onClose={() => setMenuOpen(false)} /> : null}
    </>
  );
}

/** Серая неактивная заглушка кластера навигации (браузерный верх, #1038). */
function NavStub({ glyph, label }: { glyph: string; label: string }) {
  return (
    <button
      type="button"
      disabled
      title={label}
      aria-label={label}
      className="text-muted-foreground/40 flex size-7 items-center justify-center rounded-md text-[12px] leading-none"
    >
      {glyph}
    </button>
  );
}

/**
 * Мини-окно «Приложение»: версия оболочки и состояние обновления — та же
 * пассивная модель, что у экрана «обновите приложение» (#263): скачивание
 * и установка — только по решению пользователя.
 */
function AppMenuDialog({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<ShellUpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);

  useEffect(() => {
    void shellApi
      .getShellInfo()
      .then((info) => setVersion(info.version))
      .catch(() => setVersion(null));
    void shellApi
      .getUpdateState()
      .then(setUpdate)
      .catch(() => setUpdate(null));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function install() {
    setBusy(true);
    // run_updater скачивает и ставит обновление с перезапуском оболочки;
    // недоступность манифеста — единственный безыдейный исход.
    setOutcome(await shellApi.runUpdater().catch(() => ({ status: 'unavailable' as const })));
    setBusy(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.panelAppTitle}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="bg-card text-foreground relative w-full max-w-sm rounded-[14px] border p-6 shadow-lg">
        <button
          type="button"
          aria-label={t.panelAppClose}
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground absolute right-3 top-3 flex h-9 w-9 items-center justify-center text-sm"
        >
          ✕
        </button>
        <h2 className="text-lg font-semibold">{t.panelAppTitle}</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {t.panelAppVersion}: {version ?? '…'}
        </p>
        <div className="mt-4">
          {busy ? (
            <p className="text-muted-foreground text-sm">{t.panelAppUpdateDownloading}</p>
          ) : update?.status === 'available' ? (
            <>
              <p className="text-sm">
                {t.panelAppUpdateAvailable}
                {update.version ? ` — ${update.version}` : ''}
              </p>
              <button
                type="button"
                onClick={() => void install()}
                className="bg-primary text-primary-foreground mt-3 h-9 rounded-[10px] px-4 text-sm font-medium"
              >
                {t.panelAppUpdateDownload}
              </button>
            </>
          ) : update?.status === 'downloading' ? (
            <p className="text-muted-foreground text-sm">{t.panelAppUpdateDownloading}</p>
          ) : outcome?.status === 'unavailable' ? (
            <p className="text-warning text-sm">{t.updateUnavailable}</p>
          ) : (
            <p className="text-muted-foreground text-sm">{t.panelAppNoUpdates}</p>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Поповер «Загрузки» (эпик #1038, раздел 5): реестр последних завершённых
 * загрузок оболочки — память между запусками (downloads.json в Rust), новые
 * сверху. «Показать в папке» — только у успешных записей с путём; гвард
 * каталога «Загрузки» выполняет Rust-сторона команды.
 */
function DownloadsPopover({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<DownloadEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    void shellApi
      .downloadsList()
      .then((list) => {
        if (alive) setEntries(list);
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Невидимый фон: клик/выбор мимо списка закрывает поповер. */}
      <div className="fixed inset-0" onMouseDown={onClose} />
      <section
        role="dialog"
        aria-label={t.downloadsTitle}
        className="bg-card text-foreground absolute right-0 top-full z-50 mt-1 max-h-[320px] w-80 overflow-y-auto rounded-[10px] border py-1 shadow-lg"
      >
        {entries === null ? (
          <p className="text-muted-foreground px-3 py-2 text-sm">…</p>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground px-3 py-2 text-sm">{t.downloadsEmpty}</p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="hover:bg-muted flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm leading-snug" title={entry.fileName}>
                  {entry.fileName}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                  {entry.success
                    ? finishedAtFmt.format(new Date(entry.finishedAtMs))
                    : t.downloadFailedShort}
                </p>
              </div>
              {entry.success && entry.path ? (
                <button
                  type="button"
                  onClick={() => void shellApi.downloadReveal(entry.path)}
                  className="text-muted-foreground hover:text-foreground h-7 shrink-0 rounded-[8px] px-2 text-xs"
                >
                  {t.downloadsShowInFolder}
                </button>
              ) : null}
            </div>
          ))
        )}
      </section>
    </>
  );
}
