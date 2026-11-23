// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { copyTokenLink, InvitationLinkDialog, TokenLinkField } from './invitation-link-dialog.js';

const LINK = `http://localhost/invite/${'t'.repeat(64)}`;

const writeText = vi.fn(async () => undefined);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText },
  configurable: true,
});

describe('ссылка приглашения (#101)', () => {
  it('поле показывает полную ссылку в title и копирует по кнопке', async () => {
    render(<TokenLinkField link={LINK} />);
    const field = screen.getByRole('textbox', { name: ui.employees.inviteLinkLabel });
    expect(field.getAttribute('title')).toBe(LINK);
    expect(field.textContent).toBe(LINK);
    fireEvent.click(screen.getByRole('button', { name: ui.employees.inviteCopyLink }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
  });

  it('окно: копирует только иконка, отдельной primary-кнопки нет', async () => {
    const onOpenChange = vi.fn();
    render(
      <InvitationLinkDialog
        open
        onOpenChange={onOpenChange}
        title={ui.employees.inviteLinkTitle}
        lead={ui.employees.inviteLinkLead}
        link={LINK}
        expiresAt={new Date(Date.now() + 60_000).toISOString()}
      />,
    );
    const copyButtons = screen.getAllByRole('button', { name: ui.employees.inviteCopyLink });
    expect(copyButtons).toHaveLength(1);
    fireEvent.click(copyButtons[0]!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
    fireEvent.click(screen.getByRole('button', { name: ui.common.close }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('copyTokenLink не роняет интерфейс, если буфер недоступен', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    await expect(copyTokenLink(LINK)).resolves.toBeUndefined();
  });
});
