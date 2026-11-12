/**
 * Свотч токена: значение подставляется ТОЛЬКО через `var(--…)` — ни одного
 * hex в галерее, иначе страница перестаёт быть проверкой темы (переключили
 * тему — свотчи обязаны переехать вместе с примитивами).
 *
 * Имена токенов НЕ обрезаются (замечание владельца): длинное имя переносится,
 * а не превращается в «--primary-fo…». `break-all` — потому что имя переменной
 * не имеет пробелов, обычный перенос ему не поможет.
 */
export function DevSwatch({ token, mode }: { token: string; mode: 'fill' | 'text' }) {
  const value = `var(${token})`;

  if (mode === 'text') {
    return (
      <div className="flex min-w-0 items-start gap-2" title={token}>
        <span
          className="mt-1.5 size-2.5 shrink-0 rounded-full ring-1 ring-border"
          style={{ backgroundColor: value }}
        />
        <span className="min-w-0 font-mono text-label-sm break-all" style={{ color: value }}>
          {token}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1" title={token}>
      {/* hairline-обёртка видна на любой теме: near-white плашки не сливаются
          с card, прозрачные контурные токены читаются как ступень. */}
      <div
        className="h-9 w-full rounded-md ring-1 ring-border"
        style={{ backgroundColor: value }}
      />
      <span className="min-w-0 font-mono text-label-xs break-all text-muted-foreground">
        {token}
      </span>
    </div>
  );
}
