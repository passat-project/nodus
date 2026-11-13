// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api-client.js', () => ({ api: vi.fn(async () => ({})) }));

import { AttachSendDialogHost } from './attach-send-dialog.js';
import { useChatDrafts, type PendingAttachment } from './chat-drafts.js';
import { useAttachSendDialog } from './dialog-stores.js';

/** Меню строки «⋯» окна ОТПРАВКИ (#146): закрытый когда-то как реализованный
 *  пункт жил только в режиме правки (#188) — в окне отправки меню не было.
 *  Rename правит имя черновика (уйдёт в attachmentRenames отправки),
 *  «Заменить вложение» доступно на любом составе. */

const CONV = '44444444-4444-4444-8444-444444444444';
const KEY = `conversation:${CONV}`;

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

function renderDialog() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AttachSendDialogHost />
    </QueryClientProvider>,
  );
}

/** Radix-меню открывается pointerdown (не click) — так же в jsdom. */
function openRowMenu() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Действия с вложением' }), {
    button: 0,
  });
}

describe('меню строки окна отправки (#146)', () => {
  beforeEach(() => {
    useChatDrafts.setState({ drafts: {} });
    useAttachSendDialog.setState({ scope: null, caption: '' });
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('переименование: меню есть в окне ОТПРАВКИ, имя правит черновик, окно живо', async () => {
    useChatDrafts.getState().addAttachments(KEY, [ready]);
    useAttachSendDialog.getState().open(KEY, '');
    renderDialog();

    openRowMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Переименовать файл' }));

    const nameInput = await screen.findByLabelText('Имя файла');
    expect((nameInput as HTMLInputElement).value).toBe('a');
    fireEvent.change(nameInput, { target: { value: 'Смета' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    await waitFor(() =>
      expect(useChatDrafts.getState().drafts[KEY]?.attachments[0]?.fileName).toBe('Смета.csv'),
    );
    expect(useAttachSendDialog.getState().scope).toBe(KEY);
  });

  it('«Заменить вложение» доступно и в окне отправки', async () => {
    useChatDrafts.getState().addAttachments(KEY, [ready]);
    useAttachSendDialog.getState().open(KEY, '');
    renderDialog();

    openRowMenu();
    expect(await screen.findByRole('menuitem', { name: 'Заменить вложение' })).toBeTruthy();
  });
});
