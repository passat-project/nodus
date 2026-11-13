import { devUiStrings } from '@nodus/contracts';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { DevGroup, DevSection } from '../dev-section.js';
import { TYPE_SCALE } from '../dev-ui-tokens.js';
import { ShapeGroup } from './shape-group.js';

/**
 * Ф3: типографика и форма. Лестница кеглей — живая (классы @theme), моно-строка
 * показывает `font-mono` + `tabular-nums` (нумера, время, счётчики), NodeLabel —
 * канон заголовков секций (sans 13 semibold UPPERCASE).
 */
export function TypographySection() {
  return (
    <DevSection
      id="dev-typography"
      label={devUiStrings.sections.typography}
      hint={devUiStrings.typography.ladderHint}
    >
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <DevGroup
          title={devUiStrings.typography.ladder}
          hint={devUiStrings.typography.ladderHint}
          caption="text-label-xs … text-2xl · @theme (globals.css)"
        >
          <ul className="flex flex-col gap-2">
            {TYPE_SCALE.map((step) => (
              <li
                key={step.className}
                className="flex min-w-0 items-baseline justify-between gap-4"
              >
                <span className={cn(step.className, 'min-w-0 break-words text-foreground')}>
                  {devUiStrings.typography.sample}
                </span>
                <span className="shrink-0 font-mono text-label-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {step.className} · {step.size}
                </span>
              </li>
            ))}
          </ul>
        </DevGroup>

        <div className="flex min-w-0 flex-col gap-4">
          <DevGroup
            title={devUiStrings.typography.mono}
            hint={devUiStrings.typography.monoHint}
            caption="font-mono tabular-nums text-label-sm"
          >
            <p className="font-mono text-label-sm text-foreground tabular-nums">
              {devUiStrings.typography.monoSample}
            </p>
            <p className="mt-2 font-mono text-stat text-foreground tabular-nums">82 450</p>
          </DevGroup>

          <DevGroup
            title={devUiStrings.typography.nodeLabel}
            hint={devUiStrings.typography.nodeLabelHint}
            caption="NodeLabel · @nodus/ui/components/node-label"
          >
            <div className="flex flex-wrap items-center gap-6">
              <NodeLabel label={devUiStrings.typography.nodeLabelSample} count={12} />
              <NodeLabel label={devUiStrings.typography.nodeLabelSample} chevron="down" />
              <NodeLabel label={devUiStrings.typography.nodeLabelSample} chevron="right" />
            </div>
          </DevGroup>

          <ShapeGroup />
        </div>
      </div>
    </DevSection>
  );
}
