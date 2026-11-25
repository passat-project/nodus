import { useEffect, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { SHELL_PANEL_HEIGHT, ui, type ShellUpdateState } from '@nodus/contracts';

import { shellApi, type UpdateOutcome } from './shell-ipc.js';

const t = ui.desktop;

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
export function ShellPanel() {
  const [maximized, setMaximized] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
        <div className="flex items-stretch" aria-hidden="true">
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
        <div className="flex items-stretch">
          <button
            type="button"
            title={t.panelAppMenu}
            aria-label={t.panelAppMenu}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className="hover:bg-muted flex w-[42px] items-center justify-center"
          >
            {/* Значок-заглушка Nodus: тёмно-синяя плитка со знаком. */}
            <span className="bg-primary text-primary-foreground flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-[10px] leading-none font-semibold">
              N
            </span>
          </button>
          <button
            type="button"
            disabled
            title={t.panelDownloads}
            aria-label={t.panelDownloads}
            className="text-muted-foreground/50 hover:bg-muted flex w-[42px] cursor-default items-center justify-center text-[15px]"
          >
            ⤓
          </button>
          <button
            type="button"
            title={t.panelWindowMinimize}
            aria-label={t.panelWindowMinimize}
            onClick={() => void shellApi.windowMinimize()}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-[46px] items-center justify-center text-[13px]"
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
            className={`text-muted-foreground hover:bg-muted hover:text-foreground flex w-[46px] items-center justify-center text-[13px]${snapHover ? ' bg-muted text-foreground' : ''}`}
          >
            {maximized ? '❐' : '□'}
          </button>
          <button
            type="button"
            title={t.panelWindowClose}
            aria-label={t.panelWindowClose}
            onClick={() => void shellApi.windowClose()}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex w-[46px] items-center justify-center text-[13px]"
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
      className="text-muted-foreground/40 flex w-[34px] cursor-default items-center justify-center text-[13px]"
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
