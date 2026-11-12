import { useRef } from 'react';

/**
 * Гард возврата фокуса в Radix-меню (#599).
 *
 * Radix возвращает фокус на триггер после закрытия меню — по завершении
 * анимации закрытия (~150 мс). Если пользователь за это время успел кликнуть
 * в другое поле, возврат фокуса уводит его из инлайн-редактора: `blur`
 * фиксирует пустой черновик, и редактор исчезает (гонка «Способ поступления →
 * тема письма»). Хук запоминает, что указатель ушёл из меню, и отменяет
 * возврат фокуса — он остаётся там, куда его поставил пользователь.
 *
 * Использование: `const guard = useMenuFocusGuard();` → `onOpenChange` на корне
 * меню (сбрасывает отметку) и `contentProps` на контенте.
 */
export function useMenuFocusGuard() {
  const leftMenu = useRef(false);
  return {
    onOpenChange(open: boolean) {
      if (open) leftMenu.current = false;
    },
    contentProps: {
      onPointerDownOutside: () => {
        leftMenu.current = true;
      },
      onCloseAutoFocus: (event: Event) => {
        if (leftMenu.current) event.preventDefault();
      },
    },
  };
}
