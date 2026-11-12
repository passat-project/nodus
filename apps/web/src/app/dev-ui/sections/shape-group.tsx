import { devUiStrings } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { DevGroup } from '../dev-section.js';
import { RADII } from '../dev-ui-tokens.js';

const RADIUS_LABEL = {
  control: devUiStrings.typography.radiusControl,
  surface: devUiStrings.typography.radiusSurface,
  frame: devUiStrings.typography.radiusFrame,
} as const;

/**
 * Ф3: лестница радиусов на живых коробках и тени рамы/слайдера. Тени — только
 * светлая тема (`--frame-shadow`/`--slider-shadow` = none в тёмной): коробки
 * остаются видимыми за счёт hairline, поэтому переключение темы показывает не
 * «исчезло», а «элевация сменилась тоном/бордюром».
 */
export function ShapeGroup() {
  return (
    <div className="grid min-w-0 gap-4">
      <DevGroup
        title={devUiStrings.typography.radii}
        hint={devUiStrings.typography.radiiHint}
        caption="rounded-md · rounded-lg · rounded-xl · rounded-2xl"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {RADII.map((radius) => (
            <div key={radius.className} className="flex min-w-0 flex-col gap-1.5">
              <div className={cn('h-12 w-full bg-muted ring-1 ring-border', radius.className)} />
              <span className="font-mono text-label-xs text-muted-foreground">
                {radius.px} · {RADIUS_LABEL[radius.kind]}
              </span>
            </div>
          ))}
        </div>
      </DevGroup>

      <DevGroup
        title={devUiStrings.typography.shadows}
        hint={devUiStrings.typography.shadowsHint}
        caption="frame-shadow · shadow-(--slider-shadow)"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <div className="frame-shadow h-16 w-full rounded-2xl border border-border bg-card" />
            <span className="font-mono text-label-xs text-muted-foreground">
              {devUiStrings.typography.shadowFrame}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="slider-shadow h-16 w-full rounded-2xl border border-border bg-card" />
            <span className="font-mono text-label-xs text-muted-foreground">
              {devUiStrings.typography.shadowSlider}
            </span>
          </div>
        </div>
      </DevGroup>
    </div>
  );
}
