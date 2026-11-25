import { useEffect, useLayoutEffect } from 'react';
import { useRouter } from '@tanstack/react-router';

import { isDesktopShell } from '../../../shared/desktop/desktop-bridge.js';
import { registerTabBridge } from '../../../shared/lib/tab-bridge.js';
import { activeTab, usePortalTabsStore } from './tabs-store.js';

/**
 * Контроллер вкладок (#1038 фаза C) — ЕДИНСТВЕННАЯ точка связки стора
 * вкладок с роутером TanStack. Монтируется из AppShell ТОЛЬКО в оболочке
 * (внутри эффектов гард isDesktopShell(): в браузере подписок нет и стор
 * остаётся неактивным). Три эффекта:
 *
 *  (в) старт сессии — персист вернул вкладки: ведём роутер на адрес активной
 *      (replace — стартовый адрес мусорный, дубль в истории не нужен); вкладок
 *      нет (первый запуск или валидация отбросила хранилище) — seeding
 *      текущим адресом;
 *  (б) намерение навигации — navSeq растёт (switchTab/openTab/back/forward):
 *      ведём роутер на ТЕКУЩУЮ запись истории активной вкладки (push);
 *  (а) запись внешней навигации — подписка router.subscribe('onResolved'):
 *      адрес, на который пришли, отличается от текущей записи активной
 *      вкладки ⇔ это внешняя навигация (ссылка, поиск, deep-link) — пишем её
 *      в историю вкладки. Переключение/назад-вперёд/restore приходят ровно
 *      на запись вкладки — внутренний флаг не нужен: совпадение адресов и
 *      есть признак «своей» навигации, дубликаты и гонки флагов исключены.
 *
 * Роутер берётся хуком useRouter (контекст под AppShell есть), события
 * читают стор через getState — переподписок на смену состава вкладок нет.
 */

/** href вкладки: pathname+search без hash (hash — не навигация вкладки). */
function tabHref(location: { pathname: string; searchStr: string }): string {
  return location.pathname + location.searchStr;
}

export function useTabsController(): void {
  const router = useRouter();

  // Мост для shared-слоя и чужих фич (chat, top-bar, мост оболочки):
  // открытие вкладок и сессионный заголовок активной — до регистрации no-op.
  useEffect(
    () =>
      registerTabBridge({
        openInNewTab: (url, options) =>
          usePortalTabsStore.getState().openTab(url, { focus: options?.focus ?? true }),
        openOrFocusTab: (url, prefix) => {
          const state = usePortalTabsStore.getState();
          const tab = state.tabs.find((t) => t.url.startsWith(prefix));
          if (tab) {
            state.activate(tab.id); // роутер ведёт вызвавший
            return;
          }
          const id = state.openTab(url, { focus: false });
          state.activate(id); // активна сразу, но navigate — за вызвавшим
        },
        setActiveTabTitle: (title) => usePortalTabsStore.getState().setTabTitle(title),
      }),
    [],
  );

  // (в) старт сессии — useLayoutEffect: полоса вкладок уже отрисована в кадре
  // (ShellPanel — потомок), seeding/restore ДО краски — без вспышки пустой полосы.
  useLayoutEffect(() => {
    if (!isDesktopShell()) return;
    const state = usePortalTabsStore.getState();
    const current = tabHref(router.state.location);
    const tab = activeTab(state);
    if (!tab) {
      state.seedFromLocation(current);
      return;
    }
    if (tab.url !== current) void router.navigate({ href: tab.url, replace: true });
  }, [router]);

  useEffect(() => {
    if (!isDesktopShell()) return;
    return usePortalTabsStore.subscribe((state, prev) => {
      if (state.navSeq === prev.navSeq) return;
      const tab = activeTab(state);
      if (tab) void router.navigate({ href: tab.url, replace: false });
    });
  }, [router]);

  useEffect(() => {
    if (!isDesktopShell()) return;
    return router.subscribe('onResolved', ({ toLocation }) => {
      const href = tabHref(toLocation);
      const state = usePortalTabsStore.getState();
      const tab = activeTab(state);
      if (!tab || href === tab.url) return; // «своя» навигация — уже учтена
      state.recordNavigation(href);
    });
  }, [router]);
}
