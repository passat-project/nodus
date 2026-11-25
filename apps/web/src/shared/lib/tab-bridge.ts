/**
 * Мост к вкладкам браузерного типа (#1038 фаза C, порт-адаптер — зеркала
 * card-bridge.ts): shared-слой (мост оболочки, фича чата) открывает вкладку
 * и ставит её заголовок, НЕ импортируя фичу portal-tabs (направление слоёв
 * app → features → shared, I6). Реализацию регистрирует контроллер вкладок
 * при старте оболочки (use-tabs-controller); до регистрации — no-op
 * (браузер без панели вкладок и юнит-тесты shared).
 */

export interface TabBridgePort {
  /**
   * Открыть новую вкладку с адресом (pathname+search). focus — активировать
   * сразу (по умолчанию); фоновые открытия (средний клик) — focus: false
   * (роутер поведёт контроллер при активации вкладки).
   */
  openInNewTab(url: string, options?: { focus?: boolean }): void;
  /**
   * Открыть адрес ВО ВКЛАДКЕ МОДУЛЯ: есть вкладка с url, начинающимся на
   * prefix, — активировать её (без навигационного намерения); нет — фоновая
   * новая вкладка с активацией. В ОБОИХ случаях роутер ведёт ВЫЗЫВАЮЩИЙ
   * (navigate на url) — стор примет переход записью в активную вкладку.
   */
  openOrFocusTab(url: string, prefix: string): void;
  /** Сессионный заголовок АКТИВНОЙ вкладки (undefined — вернуть метку модуля). */
  setActiveTabTitle(title: string | undefined): void;
}

let port: TabBridgePort | null = null;

export function registerTabBridge(impl: TabBridgePort): () => void {
  port = impl;
  return () => {
    if (port === impl) port = null;
  };
}

export function openInNewTab(url: string, options?: { focus?: boolean }): void {
  port?.openInNewTab(url, options);
}

export function openOrFocusTab(url: string, prefix: string): void {
  port?.openOrFocusTab(url, prefix);
}

export function setPortalTabTitle(title: string | undefined): void {
  port?.setActiveTabTitle(title);
}
