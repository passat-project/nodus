// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { NAV_MODULES } from './nav-registry.js';
import { RailCustomizeMode } from './node-rail-customize.js';
import { HIDDEN_SENTINEL } from './node-rail-rows.js';

/** AUD-032: «Применить порядок для всех» не имеет серверной части — опция
 *  скрыта из интерфейса, а подтверждение пишет только личный порядок. */
describe('RailCustomizeMode: личный порядок без «для всех»', () => {
  const byId = (id: string) => NAV_MODULES.find((m) => m.id === id);
  const first = NAV_MODULES[0]!;

  it('переключателя «для всех» нет, подтверждение отдаёт личный порядок', () => {
    const onApply = vi.fn();
    render(
      <RailCustomizeMode
        initialDraft={[first.id, HIDDEN_SENTINEL]}
        badges={() => undefined}
        isActive={() => false}
        byId={byId}
        onApply={onApply}
        onCancel={() => undefined}
      />,
    );

    expect(screen.queryByText(ui.nav.customizeForAll)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: ui.nav.customizeDone }));
    expect(onApply).toHaveBeenCalledWith([first.id], []);
  });
});
