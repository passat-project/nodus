import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Слот действий шапки карточки (#735/#746): SliderPanel рендерит пустой
 * контейнер справа, карточка переносит туда свои кнопки порталом. Портал
 * нужен потому, что шапка живёт в хосте стека (SliderPanel), а состояние
 * действий — в самой карточке; prop `headerActions` хосту не прокинуть без
 * дублирования логики проекта/задачи/письма.
 */
export const CardHeaderActionsContext = createContext<HTMLElement | null>(null);

export function CardHeaderActionsPortal({ children }: { children: ReactNode }) {
  const target = useContext(CardHeaderActionsContext);
  return target ? createPortal(children, target) : null;
}
