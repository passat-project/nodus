// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ui } from '@nodus/contracts';

import { InvitedCardPanel } from './invited-card-panel.js';

/** Правая зона приглашённого (#101): только объяснение, действий нет —
 *  управление приглашением живёт в «⋯» нижней полосы (23.11.2026). */
describe('InvitedCardPanel (#101)', () => {
  it('объясняет ограничения и не содержит кнопок', () => {
    render(<InvitedCardPanel />);
    expect(screen.getByText(ui.employees.invitedCardTitle)).toBeTruthy();
    expect(screen.getByText(ui.employees.invitedCardText)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

afterEach(cleanup);
