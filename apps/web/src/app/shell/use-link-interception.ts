import { useEffect } from 'react';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { desktopOpenExternal, isDesktopShell } from '../../shared/desktop/desktop-bridge.js';
import type { CardRef } from './card-stack.js';
import { resolveLinkTarget } from './link-target.js';

/**
 * Единый перехватчик ссылок портала (issue #644). Причина: десктоп-оболочка
 * глушила клики по `<a target="_blank">` — плагин opener перехватывал их и
 * вызывал команду, на которую у origin портала не выдано прав (ACL), ошибка
 * отклонения нигде не показывалась. Здесь решение принимает само приложение:
 *
 *  - внутренние карточки (`?cards=…`, `portal://…`) — открываем стеком
 *    ПОВЕРХ текущего экрана (без браузера и новой вкладки);
 *  - внешние http(s) и `mailto:`/`tel:` в десктопе — через разрешённый мост
 *    `open_external` (системный браузер/почта/телефон);
 *  - в браузере внешние ссылки остаются штатными (новая вкладка), Ctrl/Cmd/
 *    Shift-клик по внутренней карточке — тоже штатный (намерение «новая
 *    вкладка», не отнимаем).
 *
 * Capture-фаза на document: перехватываем раньше React-обработчиков пузыря
 * (`UrlLink` останавливает всплытие, но не отменяет переход). Если событие уже
 * отменено (диалог/меню) или ссылка `download` — не вмешиваемся.
 */
export function useLinkInterception(openCards: (refs: readonly CardRef[]) => void): void {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      // Файлы-скачивания и якоря-фрагменты — не навигация по ссылке.
      if (anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;

      const link = resolveLinkTarget(href, window.location.href);
      if (link.kind === 'default') return;

      const desktop = isDesktopShell();
      if (link.kind === 'cards') {
        // В браузере Ctrl/Cmd/Shift-клик — просьба открыть в новой вкладке.
        if (!desktop && (event.ctrlKey || event.metaKey || event.shiftKey)) return;
        event.preventDefault();
        openCards(link.cards);
        return;
      }

      // Внешние и системные схемы: в браузере — штатное поведение ссылки.
      if (!desktop) return;
      event.preventDefault();
      void desktopOpenExternal(link.url).catch(() => toast.error(ui.common.linkOpenError));
    }

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [openCards]);
}
