import type { StageColor } from '@nodus/contracts';

/** Тон стадии → классы чипа, точки-порта, тинта колонки и свотча палитры.
 *  Только токены темы «Инструмент» (I15: hex в разметке запрещён). */
export const stageTone: Record<
  StageColor,
  { chip: string; dot: string; tint: string; swatch: string }
> = {
  neutral: {
    chip: 'border-border bg-accent/40 text-secondary-foreground',
    dot: 'bg-muted-foreground',
    /* Нейтральная колонка — ступень поверхности, а не тинт: `--muted` в тёмной
       теме почти равен карточке, и тело колонки сливалось с фоном доски (§403). */
    tint: 'bg-foreground/[0.04]',
    swatch: 'bg-muted-foreground',
  },
  info: {
    chip: 'border-info/40 bg-info-soft/60 text-info',
    dot: 'bg-info',
    tint: 'bg-info-soft/40',
    swatch: 'bg-info',
  },
  success: {
    chip: 'border-success/40 bg-success-soft/60 text-success',
    dot: 'bg-success',
    tint: 'bg-success-soft/40',
    swatch: 'bg-success',
  },
  warning: {
    chip: 'border-warning/40 bg-warning-soft/60 text-warning',
    dot: 'bg-warning',
    tint: 'bg-warning-soft/40',
    swatch: 'bg-warning',
  },
  danger: {
    chip: 'border-danger/40 bg-danger-soft/60 text-danger',
    dot: 'bg-danger',
    tint: 'bg-danger-soft/40',
    swatch: 'bg-danger',
  },
  violet: {
    chip: 'border-tone-violet/40 bg-tone-violet-soft/60 text-tone-violet',
    dot: 'bg-tone-violet',
    tint: 'bg-tone-violet-soft/40',
    swatch: 'bg-tone-violet',
  },
  teal: {
    chip: 'border-tone-teal/40 bg-tone-teal-soft/60 text-tone-teal',
    dot: 'bg-tone-teal',
    tint: 'bg-tone-teal-soft/40',
    swatch: 'bg-tone-teal',
  },
  orange: {
    chip: 'border-tone-orange/40 bg-tone-orange-soft/60 text-tone-orange',
    dot: 'bg-tone-orange',
    tint: 'bg-tone-orange-soft/40',
    swatch: 'bg-tone-orange',
  },
  pink: {
    chip: 'border-tone-pink/40 bg-tone-pink-soft/60 text-tone-pink',
    dot: 'bg-tone-pink',
    tint: 'bg-tone-pink-soft/40',
    swatch: 'bg-tone-pink',
  },
  cyan: {
    chip: 'border-tone-cyan/40 bg-tone-cyan-soft/60 text-tone-cyan',
    dot: 'bg-tone-cyan',
    tint: 'bg-tone-cyan-soft/40',
    swatch: 'bg-tone-cyan',
  },
};

export const stageColorOrder: StageColor[] = [
  'neutral',
  'info',
  'success',
  'warning',
  'danger',
  'violet',
  'teal',
  'orange',
  'pink',
  'cyan',
];
