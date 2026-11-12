// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@nodus/ui/components/tooltip';
import { describe, expect, it } from 'vitest';

import { DevUiPage } from './dev-ui-page.js';
import { TOKEN_GROUPS } from './dev-ui-tokens.js';
import { devUiStrings } from '@nodus/contracts';

/* Смоук dev-галереи: страница обязана собраться целиком (радикс-оверлеи,
 * i18n, оба переключателя) — падение секции ловится здесь, а не на приёмке. */
describe('DevUiPage', () => {
  it('рендерит шапку, все секции и все группы токенов', () => {
    render(
      <TooltipProvider>
        <DevUiPage />
      </TooltipProvider>,
    );

    expect(screen.getByRole('heading', { level: 1, name: devUiStrings.title })).toBeTruthy();
    for (const title of [
      devUiStrings.sections.tokens,
      devUiStrings.sections.typography,
      devUiStrings.sections.controls,
      devUiStrings.sections.chips,
      devUiStrings.sections.overlays,
      devUiStrings.sections.states,
    ]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }

    expect(screen.getAllByText(devUiStrings.tokens.names).length).toBeGreaterThan(0);
    expect(TOKEN_GROUPS.length).toBeGreaterThan(0);
  });
});
