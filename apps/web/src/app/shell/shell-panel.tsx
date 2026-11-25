import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Link,
  Minus,
  RefreshCw,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import {
  DESKTOP_BRIDGE_EVENTS,
  SHELL_PANEL_HEIGHT,
  shellFocusEventSchema,
  ui,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import {
  desktopCopyText,
  desktopWindowClose,
  desktopWindowIsMaximized,
  desktopWindowMinimize,
  desktopWindowStartDragging,
  desktopWindowToggleMaximize,
  onDesktopEvent,
} from '../../shared/desktop/desktop-bridge.js';
import { useDesktopApp } from '../../shared/desktop/use-desktop-app.js';
import { usePortalUpdateStore } from '../../features/portal-update/model/portal-update-store.js';
import { TabsStrip } from '../../features/portal-tabs/components/tabs-strip.js';
import {
  canBack,
  canForward,
  usePortalTabsStore,
} from '../../features/portal-tabs/model/tabs-store.js';
import { AppUpdateWindow } from './app-update-window.js';
import { DownloadsPopoverButton } from './downloads-popover.js';
import { LogoIcon } from './logo-icon.js';
import { UpdateCallout } from './update-callout.js';

/** Тактильный отклик копирования адреса: галочка на полторы секунды. */
const COPY_FEEDBACK_MS = 1500;

const PANEL_BUTTON_CLASS = 'relative text-muted-foreground hover:bg-accent hover:text-foreground';

/**
 * Панель безрамочного окна оболочки (ADR-0055, #1038): первая строка окна над
 * мягкой рамой, рисуется страницей ТОЛЬКО внутри оболочки (монтаж и гвард —
 * app-shell). Слева направо: назад/вперёд по ИСТОРИИ АКТИВНОЙ ВКЛАДКИ
 * (стор вкладок фазы C), ⟳ с зелёной точкой обновления портала, копирование
 * адреса · полоса вкладок + остаток ширины — drag-зона окна · «Приложение»
 * со знаком Nodus, «Загрузки» (реестр загрузок оболочки, поповер), кнопки окна.
 */
export function ShellPanel() {
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  // Коллаут обновления портала: после ручного закрытия не показывается
  // до конца сессии — панель живёт с окном, флаг не переживает перезагрузку.
  const [calloutDismissed, setCalloutDismissed] = useState(false);

  return (
    <div
      data-shell-panel
      className="relative z-40 shrink-0 border-b border-border bg-card"
      style={{ height: SHELL_PANEL_HEIGHT }}
    >
      <div className="flex h-full items-center">
        <div className="flex items-center pl-1">
          <BackForwardButtons />
          <ReloadButton />
          <CopyAddressButton />
        </div>

        {/* Зона вкладок: полоса (TabsStrip гасит pointerdown/dblclick —
            клики по вкладкам окно не тащат), остаток ширины — drag-зона
            окна; pointerdown кнопкой 0 тащит окно, двойной клик
            разворачивает. На кнопках панели перехвата нет — обработчики
            живут только здесь. */}
        <div
          className="flex h-full min-w-0 flex-1"
          data-shell-drag-zone
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            desktopWindowStartDragging();
          }}
          onDoubleClick={() => desktopWindowToggleMaximize()}
        >
          <TabsStrip />
        </div>

        <div className="flex items-center pr-1">
          <AppMenuButton onOpen={() => setAppMenuOpen(true)} />
          <DownloadsPopoverButton />
          <PanelIconButton title={ui.desktop.panelWindowMinimize} onClick={desktopWindowMinimize}>
            <Minus className="size-4" strokeWidth={1.75} />
          </PanelIconButton>
          <MaximizeButton />
          <PanelIconButton title={ui.desktop.panelWindowClose} onClick={desktopWindowClose}>
            <X className="size-4" strokeWidth={1.75} />
          </PanelIconButton>
        </div>
      </div>

      {!calloutDismissed ? <UpdateCallout onClose={() => setCalloutDismissed(true)} /> : null}
      <AppUpdateWindow open={appMenuOpen} onOpenChange={setAppMenuOpen} />
    </div>
  );
}

/**
 * ◀▶ истории АКТИВНОЙ вкладки (#1038 фаза C): стор вкладок ведёт свою
 * историю, контроллер применяет намерение навигацией роутера. Селекторы —
 * выведенные boolean: перерисовка только на смене края (rerender-канон).
 */
function BackForwardButtons() {
  const canGoBack = usePortalTabsStore((s) => canBack(s, s.activeId));
  const canGoForward = usePortalTabsStore((s) => canForward(s, s.activeId));
  return (
    <>
      <PanelIconButton
        title={ui.desktop.panelBack}
        disabled={!canGoBack}
        onClick={() => usePortalTabsStore.getState().back()}
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
      </PanelIconButton>
      <PanelIconButton
        title={ui.desktop.panelForward}
        disabled={!canGoForward}
        onClick={() => usePortalTabsStore.getState().forward()}
      >
        <ArrowRight className="size-4" strokeWidth={1.75} />
      </PanelIconButton>
    </>
  );
}

/** Кнопка панели: тихая ghost-иконка топбарного калибра с title-подсказкой. */
function PanelIconButton({
  title,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & {
  title: string;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={title}
      title={title}
      className={PANEL_BUTTON_CLASS}
      {...rest}
    >
      {children}
    </Button>
  );
}

/** ⟳: перезагрузка страницы; зелёная точка — на раздаче новая сборка портала. */
function ReloadButton() {
  const updateAvailable = usePortalUpdateStore((s) => s.updateAvailable);
  return (
    <PanelIconButton title={ui.desktop.panelReload} onClick={() => window.location.reload()}>
      <RefreshCw className="size-4" strokeWidth={1.75} />
      {updateAvailable && (
        <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-success" />
      )}
    </PanelIconButton>
  );
}

/** 🔗: адрес страницы в буфер обмена через мост (галочка — отклик на успех). */
function CopyAddressButton() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onCopy = () => {
    // Лимит длины — на стороне моста (desktopCopyText): длинный URL молча
    // не копируется, отклика-галочки нет.
    void desktopCopyText(window.location.href).then((done) => {
      if (!done) return;
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    });
  };

  return (
    <PanelIconButton title={ui.desktop.panelCopyAddress} onClick={onCopy}>
      {copied ? (
        <Check className="size-4 text-success" strokeWidth={1.75} />
      ) : (
        <Link className="size-4" strokeWidth={1.75} />
      )}
    </PanelIconButton>
  );
}

/**
 * □/❐: id зафиксирован контрактом — snap-плагин оболочки навешивает на него
 * нативный HTMAXBUTTON-оверлей (Win11 Snap Layouts), КЛИК обрабатывает он —
 * обработчика здесь НЕТ и hover-подсветку оверлея не перебиваем. Состояние
 * иконки читается на mount и на событие фокуса окна (shell-focus приходит и
 * после разворота/восстановления); оболочка без события — состояние остаётся
 * с монтирования.
 */
function MaximizeButton() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let alive = true;
    const pull = () => {
      void desktopWindowIsMaximized().then((value) => {
        if (alive && value !== null) setMaximized(value);
      });
    };
    pull();
    const unsubscribe = onDesktopEvent(
      DESKTOP_BRIDGE_EVENTS.shellFocus,
      shellFocusEventSchema,
      pull,
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  const label = maximized ? ui.desktop.panelWindowRestore : ui.desktop.panelWindowMaximize;
  return (
    <PanelIconButton title={label} id="portal-window-maximize">
      {maximized ? (
        <Copy className="size-4" strokeWidth={1.75} />
      ) : (
        <Square className="size-4" strokeWidth={1.75} />
      )}
    </PanelIconButton>
  );
}

/** «Приложение»: монохромный знак Nodus; точка — готовое обновление оболочки. */
function AppMenuButton({ onOpen }: { onOpen: () => void }) {
  const updateReady = useDesktopApp().updateState.status === 'available';
  return (
    <PanelIconButton title={ui.desktop.panelAppMenu} onClick={onOpen}>
      <LogoIcon className="size-4" />
      {updateReady && (
        <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-success" />
      )}
    </PanelIconButton>
  );
}
