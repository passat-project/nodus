/** Заголовок секции карточки профиля (#923): «Информация о сотруднике»,
 *  «Подчинённые». Толще и чуть больше NodeLabel, обычный регистр — секция
 *  данных, а не табличная колонка (точную типографику доводит ui-writer). */
export function ProfileSectionHeading({ label, count }: { label: string; count?: number }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
      {label}
      {count !== undefined ? (
        <span className="font-mono text-xs font-normal text-muted-foreground tabular-nums">
          {count}
        </span>
      ) : null}
    </h3>
  );
}
