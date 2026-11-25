import { useEffect, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { SHELL_PANEL_HEIGHT, ui } from '@nodus/contracts';

import { shellApi } from './shell-ipc.js';
import { DownloadIcon } from './icons.js';
import { AppMenuDialog } from './app-menu-dialog.js';
import { DownloadsPopover } from './downloads-popover.js';

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
 * строка панели не масштабируется --ui-scale). Диалог «Приложение» и
 * поповер «Загрузки» — соседние файлы (лимит строк, I5).
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
              оболочки с «Показать в папке». Тот же калибр, что у знака —
              единый ритм правого кластера (вердикт владельца 25.11). */}
          <div className="relative flex">
            <button
              type="button"
              title={t.panelDownloads}
              aria-label={t.panelDownloads}
              aria-haspopup="dialog"
              aria-expanded={downloadsOpen}
              onClick={() => setDownloadsOpen(true)}
              className="text-muted-foreground flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground"
            >
              <DownloadIcon className="size-4" />
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
