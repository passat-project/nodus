import { Fragment, type ReactNode } from 'react';
import type { FormDecor, FormHeight, FormWidth } from '@nodus/contracts';
import { formRows, ui } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

/**
 * Окно ввода на общей раскладке (#496, Р2): одна сетка для окна создания,
 * окна кнопки, папки, проекта и строки реестра — и у сотрудника, и в
 * редакторе. Строки — `formRows`: две половины подряд рядом, остальное на
 * всю строку; уже 30rem — одна колонка. `@container` — на своей обёртке
 * (не на предке порталов; пороги в rem следуют масштабу, gotcha frontend.md).
 */

export interface FormGridItem {
  id: string;
  width: FormWidth;
  node: ReactNode;
}

export function FormGrid({
  items,
  className,
}: {
  items: readonly FormGridItem[];
  className?: string;
}) {
  const rows = formRows(items, (item) => item.width === 'half');
  return (
    <div className={cn('min-w-0 @container', className)}>
      <div className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-3 @min-[30rem]:grid-cols-2">
        {rows.map((row) => (
          <Fragment key={row[0]!.id}>
            {row.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'min-w-0',
                  row.length === 1 && item.width !== 'half' && '@min-[30rem]:col-span-2',
                )}
              >
                {item.node}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** Высота текстового поля (Р1): базовая высота, дальше растёт с текстом. */
export function formHeightClass(height: FormHeight | undefined): string {
  switch (height) {
    case 'line':
      return '[&_textarea]:min-h-8';
    case 'large':
      return '[&_textarea]:min-h-40';
    case 'lines':
      return '[&_textarea]:min-h-20';
    default:
      return '';
  }
}

/** Оформление окна: заголовок, пояснение, отступ. */
export function FormDecorView({ decor }: { decor: FormDecor }) {
  if (decor.kind === 'gap') return <div aria-hidden className="h-2" />;
  if (decor.kind === 'heading') {
    return <h3 className="pt-1 text-sm font-medium wrap-anywhere text-foreground">{decor.text}</h3>;
  }
  return (
    <p className="text-xs whitespace-pre-line wrap-anywhere text-muted-foreground">{decor.text}</p>
  );
}

/** Поле окна: подпись сверху (Р14), контрол, подсказка; `notice` — метка
 *  справа от подписи (замок «Закрепится после…», «из условия»). */
export function FormFieldShell({
  label,
  required = false,
  hint,
  notice,
  height,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string | null;
  notice?: ReactNode;
  height?: FormHeight;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', formHeightClass(height))}>
      <div className="flex min-w-0 items-center gap-1">
        <NodeLabel label={label} className="min-w-0" />
        {required ? (
          <span aria-hidden className="text-label leading-none text-danger">
            *
          </span>
        ) : null}
        {required ? <span className="sr-only">{ui.taskCreate.requiredMark}</span> : null}
        {notice ? <span className="ml-auto flex shrink-0 items-center">{notice}</span> : null}
      </div>
      <div className="min-w-0">{children}</div>
      {hint ? <p className="text-xs wrap-anywhere text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
