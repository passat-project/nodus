// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ui } from '@nodus/contracts';

vi.mock('../api-client.js', () => ({
  api: vi.fn(async () => ({})),
}));

import { AttachSendDialogHost } from './attach-send-dialog.js';
import { useChatDrafts, type PendingAttachment } from './chat-drafts.js';
import type { ComposerSubmit } from './composer-submit.js';
import { useAttachSendDialog } from './dialog-stores.js';
import { registerScopeConversation } from './scope-conversations.js';
import { registerScopeSubmit } from './submit-registry.js';

/** @упоминания подписи окна вложений (#239, #844): автокомплит над полем —
 *  портал в body с высотой 9 рядов и прокруткой (НЕ сжимается overflow окна);
 *  выбор вставляет чип, отправка несёт wire-токен. */

const CONV = '11111111-1111-4111-8111-111111111111';
const KEY = `conversation:${CONV}`;
const ALICE_ID = '33333333-3333-4333-8333-333333333333';

const ready: PendingAttachment = {
  localId: 'a',
  fileName: 'a.csv',
  mime: 'text/csv',
  size: 10,
  progress: 1,
  status: 'ready',
  attachment: {
    id: 'att-a',
    fileId: 'file-a',
    name: 'a.csv',
    size: 10,
    mime: 'text/csv',
    kind: 'file',
    url: null,
    thumbnailUrl: null,
    previewKind: 'file',
    pdfUrl: null,
    width: null,
    height: null,
  },
  objectUrl: null,
};

let queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
/** Тип мока — по форме ответа (generic api<T> mockImplementation не выразит). */
let apiMock: Mock<(url: unknown) => Promise<unknown>>;

function renderDialog() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AttachSendDialogHost />
    </QueryClientProvider>,
  );
}

describe('attach-send-dialog: @упоминания подписи (#239)', () => {
  beforeEach(async () => {
    useChatDrafts.setState({ drafts: {} });
    useAttachSendDialog.setState({ scope: null, caption: '' });
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    registerScopeConversation(KEY, CONV);
    const { api } = await import('../api-client.js');
    apiMock = vi.mocked(api) as unknown as typeof apiMock;
    apiMock.mockImplementation((url) => {
      // Состав беседы: Алиса-участник (автокомплит без дебаунса поиска).
      if (String(url).includes('/members')) {
        return Promise.resolve({
          items: [
            { user: { id: ALICE_ID, displayName: 'Алиса Тест', avatarUrl: null }, role: 'member' },
          ],
          nextCursor: null,
        });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
    registerScopeConversation(KEY, undefined);
    apiMock.mockReset();
  });

  it('подпись с токенами открывается ВИДИМЫМ текстом; отправка уносит wire', async () => {
    const wire = `Привет @[Алиса Тест](user:${ALICE_ID})`;
    const payloads: ComposerSubmit[] = [];
    const unregister = registerScopeSubmit(KEY, (payload) => {
      payloads.push(payload);
      return Promise.resolve({});
    });
    useChatDrafts.getState().addAttachments(KEY, [ready]);
    useAttachSendDialog.getState().open(KEY, wire);
    renderDialog();

    const field = screen.getByPlaceholderText(ui.chat.attachCaption) as HTMLTextAreaElement;
    // Display-текст, не сырая разметка (#239: раньше поле показывало токен).
    expect(field.value).toBe('Привет Алиса Тест');

    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(payloads[0]?.text).toBe(wire));
    unregister();
  });

  it('панель @ в окне — портал в body на полные 360px, не сжата окном (#844)', async () => {
    useChatDrafts.getState().addAttachments(KEY, [ready]);
    useAttachSendDialog.getState().open(KEY, '');
    renderDialog();

    const field = screen.getByPlaceholderText(ui.chat.attachCaption) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: '@' } });

    const list = await screen.findByRole('listbox');
    // Портал: обрезать панель overflow окна больше нечему.
    expect(list.parentElement).toBe(document.body);
    expect(list.style.position).toBe('fixed');
    expect(list.style.maxHeight).toBe('360px');
    // Модальный Radix ставит body pointer-events:none — панель обязана
    // вернуть auto, иначе в окне не работают мышь, колесо и наведение.
    expect(list.style.pointerEvents).toBe('auto');
    expect(list.className).toContain('overflow-y-auto');
  });

  it('«@» открывает панель; выбор вставляет чип; отправка несёт токен', async () => {
    const payloads: ComposerSubmit[] = [];
    const unregister = registerScopeSubmit(KEY, (payload) => {
      payloads.push(payload);
      return Promise.resolve({});
    });
    useChatDrafts.getState().addAttachments(KEY, [ready]);
    useAttachSendDialog.getState().open(KEY, '');
    renderDialog();

    const field = screen.getByPlaceholderText(ui.chat.attachCaption) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: '@' } });

    // Первый кандидат — закреплённое «Все»; выбираем Алису.
    const aliceOption = (await screen.findByText('Алиса Тест')).closest('[role="option"]')!;
    fireEvent.mouseDown(aliceOption); // каретка остаётся в поле (канон панели)

    await waitFor(() => expect(field.value).toBe('Алиса Тест '));
    expect(field.value).not.toContain('@[');

    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(payloads[0]?.text).toBe(`@[Алиса Тест](user:${ALICE_ID})`));
    unregister();
  });
});
