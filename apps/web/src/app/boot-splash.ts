import { useLayoutEffect } from 'react';

/**
 * Стартовая заставка (`index.html`, id — та же строка, сверку держит тест):
 * живёт рядом с `#root`, React её не трогает и держится на экране, пока
 * грузятся скрипты и идёт вход, — вместо белого листа (#1051). Первый
 * реальный экран приложения снимает её в layout-эффекте: до покраски кадра,
 * без белой паузы.
 *
 * Снимают корневая рамка роутера (оболочка, вход) и системные экраны (ошибка
 * роутера, «не найдено»): последние заменяют корневую рамку, а не рендерятся
 * в ней.
 */
export const BOOT_SPLASH_ID = 'nodus-boot-splash';

export function removeBootSplash(): void {
  document.getElementById(BOOT_SPLASH_ID)?.remove();
}

export function useRemoveBootSplash(): void {
  useLayoutEffect(removeBootSplash, []);
}
