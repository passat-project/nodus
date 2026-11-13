import { cn } from '@nodus/ui/lib/utils';

/** Кольцо прогресса коллективной кнопки (#434): тонкая дорожка + индиго. */
export function PressRing({
  pressed,
  total,
  className,
}: {
  pressed: number;
  total: number;
  className?: string;
}) {
  const radius = 6;
  const length = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.min(1, pressed / total) : 0;
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('block size-4 shrink-0 self-center', className)}
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="2"
      />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${length * ratio} ${length}`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}
