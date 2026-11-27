import { ui } from '@nodus/contracts';

/**
 * Крестик попапа (канон Telegram notifyClose): SVG-глиф ≈ 70% зоны кнопки,
 * ховер ровно по видимой кнопке (фидбек 08.10). Один компонент на обе карточки
 * (#1068): чатовая ставит его абсолютно в правый верхний угол, карточка
 * скачивания — последним элементом строки, чтобы уровень не зависел от
 * состояния, серии и длины имени файла.
 */
export function PopupCloseButton({
  onClose,
  className,
}: {
  onClose: () => void;
  /** Позиционирование конкретной карточки; базовая геометрия — здесь. */
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ui.common.close}
      onClick={onClose}
      className={`text-muted-foreground hover:text-foreground hover:bg-accent flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 ${className ?? ''}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        className="size-3.5"
        aria-hidden
      >
        <path d="M5 5l14 14M19 5 5 19" />
      </svg>
    </button>
  );
}
