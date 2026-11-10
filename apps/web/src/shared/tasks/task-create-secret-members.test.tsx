// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ui } from '@nodus/contracts';

import { TaskCreateSecretMembers } from './task-create-secret-members.js';

afterEach(cleanup);

describe('TaskCreateSecretMembers (#674)', () => {
  it('показывает только имена без лишних подсказок', () => {
    render(<TaskCreateSecretMembers names={['Иванов И.', 'Петров П.']} canFix />);

    expect(screen.getByRole('alert').textContent).toBe(
      `${ui.projects.secretMembersNoAccess}: Иванов И., Петров П.`,
    );
    expect(screen.queryByText(ui.projects.secretMembersCanAdd)).toBeNull();
  });

  it('обычному участнику добавляет пояснение отдельной строкой', () => {
    render(<TaskCreateSecretMembers names={['Иванов И.']} canFix={false} />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(ui.projects.secretMembersNoAccess);
    expect(alert.textContent).toContain(ui.projects.secretMembersCanAdd);
    expect(alert.querySelectorAll('p')).toHaveLength(2);
  });
});
