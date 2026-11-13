import { devUiStrings } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { DevGroup, DevSection } from '../dev-section.js';
import { DevSwatch } from '../dev-swatch.js';
import { TOKEN_GROUPS, type TokenGroupId } from '../dev-ui-tokens.js';

/** Подписи групп токенов — из i18n (I15), не литералами в разметке. */
const LABELS: Record<TokenGroupId, { title: string; hint: string }> = {
  surfaces: { title: devUiStrings.tokens.surfaces, hint: devUiStrings.tokens.surfacesHint },
  semantic: { title: devUiStrings.tokens.semantic, hint: devUiStrings.tokens.semanticHint },
  action: { title: devUiStrings.tokens.action, hint: devUiStrings.tokens.actionHint },
  contour: { title: devUiStrings.tokens.contour, hint: devUiStrings.tokens.contourHint },
  tones: { title: devUiStrings.tokens.tones, hint: devUiStrings.tokens.tonesHint },
  bubbles: { title: devUiStrings.tokens.bubbles, hint: devUiStrings.tokens.bubblesHint },
  files: { title: devUiStrings.tokens.files, hint: devUiStrings.tokens.filesHint },
  names: { title: devUiStrings.tokens.names, hint: devUiStrings.tokens.namesHint },
  charts: { title: devUiStrings.tokens.charts, hint: devUiStrings.tokens.chartsHint },
};

/**
 * Ф2: галерея семантических токенов обеих тем. Плашки — живые: смена темы в
 * шапке перекрашивает их тем же механизмом, что и примитивы (`data-theme`),
 * поэтому расхождение значения и контраста видно сразу.
 */
export function TokensSection() {
  return (
    <DevSection id="dev-tokens" label={devUiStrings.sections.tokens}>
      <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
        {TOKEN_GROUPS.map((group) => {
          const { title, hint } = LABELS[group.id];
          return (
            <DevGroup key={group.id} title={title} hint={hint} caption={`tokens · ${group.id}`}>
              <div
                className={cn(
                  'grid min-w-0 gap-3',
                  group.mode === 'text'
                    ? 'grid-cols-2 sm:grid-cols-3'
                    : 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5',
                )}
              >
                {group.tokens.map((token) => (
                  <DevSwatch key={token} token={token} mode={group.mode} />
                ))}
              </div>
            </DevGroup>
          );
        })}
      </div>
    </DevSection>
  );
}
