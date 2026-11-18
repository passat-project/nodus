/** Поле окна профиля: метка и контрол одной колонкой. Пояснение живёт В
 *  МЕТКЕ (`· логин`), не строкой под контролом — подпись снизу сдвигает метку
 *  и ломает горизонталь «метка — поле» (канон форм, вердикт 07.11.2026);
 *  полный текст пояснения — в title метки. */
export function ProfileField({
  label,
  hint,
  hintShort,
  children,
}: {
  label: string;
  hint?: string;
  hintShort?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="flex min-w-0 items-baseline gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        {hintShort ? (
          <span className="shrink-0 text-label-xs font-normal text-muted-foreground" title={hint}>
            · {hintShort}
          </span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

/** Значение только для чтения: в структуре — синим, как поле-реестр карточки. */
export function ProfileReadonlyValue({ value, tone }: { value: string; tone?: 'info' }) {
  return (
    <span
      className={
        tone === 'info'
          ? 'flex min-h-8 items-center text-sm text-info'
          : 'flex min-h-8 items-center text-sm'
      }
    >
      {value}
    </span>
  );
}
