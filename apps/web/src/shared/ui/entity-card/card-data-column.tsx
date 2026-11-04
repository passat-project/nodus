import type { ReactNode } from 'react';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Левая колонка данных карточки сущности — ОДНА на задачу, письмо и проект
 * (устраняет рассинхрон «у каждой карточки свой max-w и свои отступы»):
 * скролл + p-6, колонка центрируется в панели, на узкой зоне — одна колонка
 * полей (28rem). `gutter` — фиксированный левый отступ под кнопку навигатора
 * (задача): кнопка живёт в отступе и не сдвигает описание/поля, контент
 * получает pl-16. Позиция кнопки фиксирована от левой границы карточки и не
 * пересчитывается при растягивании панели.
 */
export function CardDataColumn({
  children,
  gutter,
  className,
}: {
  children: ReactNode;
  /** Содержимое фиксированного левого отступа (кнопка навигатора). */
  gutter?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('content-fade relative min-h-0 flex-1 overflow-y-auto p-6', className)}>
      {gutter ? <div className="absolute top-6 left-[1.625rem]">{gutter}</div> : null}
      <div className={cn('mx-auto max-w-4xl pb-4 @max-[55rem]:max-w-[28rem]', gutter && 'pl-16')}>
        {children}
      </div>
    </div>
  );
}
