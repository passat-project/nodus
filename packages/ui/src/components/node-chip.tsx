import type { ReactNode } from 'react';
import { cn } from '#lib/utils';

const tones = {
  muted: 'border-border text-muted-foreground',
  active: 'border-port/60 text-foreground shadow-[0_0_8px_var(--glow)]',
  success: 'border-success/40 text-success',
  warning: 'border-warning/40 text-warning',
  danger: 'border-danger/40 text-danger',
  info: 'border-info/40 text-info',
  violet: 'border-tone-violet/40 text-tone-violet',
  teal: 'border-tone-teal/40 text-tone-teal',
  orange: 'border-tone-orange/40 text-tone-orange',
  pink: 'border-tone-pink/40 text-tone-pink',
  cyan: 'border-tone-cyan/40 text-tone-cyan',
} as const;

/** Чип статуса/значения: SANS 11px (раунд 2 #60: статусы — слова, не код;
 * моно оставлен только данным-ключам через className font-mono). */
function NodeChip({
  tone = 'muted',
  className,
  children,
}: {
  tone?: keyof typeof tones;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-label-sm leading-none font-medium tabular-nums select-none',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export { NodeChip };
