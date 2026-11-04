import type { ProcessType } from '@nodus/contracts';

/** Тон плитки-значка типа задачи (токены темы, I15). */
export function toneOf(color: ProcessType['color']): string {
  const tones: Record<ProcessType['color'], string> = {
    neutral: 'border-border bg-muted text-muted-foreground',
    info: 'border-info/40 bg-info-soft/60 text-info',
    success: 'border-success/40 bg-success-soft/60 text-success',
    warning: 'border-warning/40 bg-warning-soft/60 text-warning',
    danger: 'border-danger/40 bg-danger-soft/60 text-danger',
    violet: 'border-tone-violet/40 bg-tone-violet-soft/60 text-tone-violet',
    teal: 'border-tone-teal/40 bg-tone-teal-soft/60 text-tone-teal',
    orange: 'border-tone-orange/40 bg-tone-orange-soft/60 text-tone-orange',
    pink: 'border-tone-pink/40 bg-tone-pink-soft/60 text-tone-pink',
    cyan: 'border-tone-cyan/40 bg-tone-cyan-soft/60 text-tone-cyan',
  };
  return tones[color];
}
