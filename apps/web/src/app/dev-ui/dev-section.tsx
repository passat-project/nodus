import type { ReactNode } from 'react';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Каркас секции галереи: моно-заголовок NodeLabel (канон заголовков секций),
 * пояснение одной строкой и тело. Секции — единственный «хром» страницы:
 * никаких своих теней/градиентов, только токены темы.
 */
export function DevSection({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex min-w-0 scroll-mt-4 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2>
          <NodeLabel label={label} />
        </h2>
        {hint ? <p className="text-label-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Группа внутри секции: панель примитива (node-panel) + моно-подпись класса. */
export function DevGroup({
  title,
  hint,
  caption,
  bodyClassName,
  children,
}: {
  title: string;
  hint?: string;
  caption?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="node-panel flex min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-body-xs font-semibold text-foreground">{title}</h3>
        {hint ? <p className="text-label-sm text-muted-foreground">{hint}</p> : null}
      </div>
      <div className={cn('min-w-0', bodyClassName)}>{children}</div>
      {caption ? (
        <p className="font-mono text-label-xs break-all text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  );
}

/** Подпись контрола: имя класса/примитива (моно, вторичный тон).
 *  Идентификаторы кода — литералами, не через i18n: правило — в шапке
 *  `dev-ui-tokens.ts` (I15 распространяется на текст интерфейса, не на имена
 *  классов/токенов). Русский текст в подписи обязан идти из `devUiStrings`. */
export function DevCaption({ children }: { children: ReactNode }) {
  return <span className="font-mono text-label-xs text-muted-foreground">{children}</span>;
}

/** Один контрол с подписью под ним — вертикальная ячейка галереи. */
export function DevField({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {children}
      <DevCaption>{label}</DevCaption>
    </div>
  );
}
