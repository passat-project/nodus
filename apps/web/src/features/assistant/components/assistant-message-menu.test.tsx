// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ui } from '@nodus/contracts';

import { AssistantMessageMenu } from './assistant-message-menu.js';
import { toChatMessage } from '../model/assistant-messages.js';

/**
 * Контекстные команды на пузыре ассистента (18.11.2026): правый клик открывает
 * меню канона чатов с «Копировать», которое кладёт исходный текст в буфер.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function bubble(text: string) {
  const message = toChatMessage(
    {
      id: '00000000-0000-4000-8000-000000000001',
      role: 'assistant',
      text,
      reasoning: null,
      createdAt: '2026-11-18T09:00:00.000Z',
      runId: null,
      streaming: false,
      errorCode: null,
      toolCalls: [],
    },
    null,
  );
  return render(
    <AssistantMessageMenu message={message}>
      <div data-testid="bubble">{text}</div>
    </AssistantMessageMenu>,
  );
}

describe('AssistantMessageMenu: контекстное меню', () => {
  it('правый клик открывает меню с «Копировать» и копирует текст', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    // Radix-меню в jsdom требует pointer-capture/scroll-заглушек.
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.setPointerCapture ??= () => undefined;
    Element.prototype.releasePointerCapture ??= () => undefined;
    Element.prototype.scrollIntoView ??= () => undefined;

    bubble('Ответ агента');
    fireEvent.contextMenu(screen.getByTestId('bubble'));
    const item = await screen.findByRole('menuitem', { name: ui.chat.menu.copy });
    fireEvent.click(item);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Ответ агента'));
  });
});
