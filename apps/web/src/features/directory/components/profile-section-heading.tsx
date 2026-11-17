import { cn } from '@nodus/ui/lib/utils';

/**
 * Заголовок секции карточки профиля (#923): «Информация о сотруднике»,
 * «Подчинённые». 14px semibold обычным регистром — между метками полей (13)
 * и значениями (15): секцию ведёт ВЕС и полный тон текста, а не кегль, поэтому
 * заголовок не спорит с содержимым (вердикт владельца, точная типографика —
 * ui-writer). Счётчик — моно, как все числа канона (`tabular-nums`), сидит на
 * общей базовой линии с подписью, приглушён и не тянет на себя взгляд.
 */
export function ProfileSectionHeading({
  label,
  count,
  className,
}: {
  label: string;
  count?: number;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        'flex items-baseline gap-2 text-label-lg font-semibold text-foreground',
        className,
      )}
    >
      {label}
      {count !== undefined ? (
        <span className="font-mono text-label-sm font-normal text-muted-foreground tabular-nums">
          {count}
        </span>
      ) : null}
    </h3>
  );
}
