// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

vi.mock('../api-client.js', () => ({
  // DELETE снятой строки — безопасный промис.
  api: vi.fn(async () => ({})),
  // Загрузка из дропа не завершается: строка живёт в uploading.
  apiUpload: vi.fn(() => new Promise(() => undefined)),
}));

import { AttachSendDialogHost } from './attach-send-dialog.js';
import { useChatDrafts, type PendingAttachment } from './chat-drafts.js';
import { useAttachSendDialog } from './dialog-stores.js';

/**
 * Окно отправки: второй заход по приёмке #713 — фаза «Обработка…» после 100%
 * (#717) и дроп файла прямо в открытое окно (#716). Отдельный файл: базовый
 * `attach-send-dialog.test.tsx` уже на пределе размера (I5).
 */

const KEY = 'conversation:22222222-2222-4222-8222-222222222222';

const pending = (
  localId: string,
  status: 'uploading' | 'processing' | 'ready' | 'error' = 'ready',
): PendingAttachment => ({
  localId,
  fileName: `${localId}.csv`,
  mime: 'text/csv',
  size: 10,
  progress: status === 'ready' ? 1 : 0.4,
  status,
  attachment:
    status === 'ready'
      ? {
          id: `att-${localId}`,
          fileId: `file-${localId}`,
          name: `${localId}.csv`,
          size: 10,
          mime: 'text/csv',
          kind: 'file',
          url: null,
          thumbnailUrl: null,
          previewKind: 'file',
          pdfUrl: null,
          width: null,
          height: null,
        }
      : null,
  objectUrl: null,
});

let queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  useChatDrafts.setState({ drafts: {} });
  useAttachSendDialog.setState({ scope: null, caption: '' });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

function renderDialog() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AttachSendDialogHost />
    </QueryClientProvider>,
  );
}

describe('attach-send-dialog: фаза обработки (#717)', () => {
  it('кнопка объясняет ожидание сервера, строка — «Обработка…»', () => {
    // Тело принято сервером, id вложения ещё нет: отправка ждёт, но подсказка
    // говорит про обработку, а не про «дождитесь загрузки».
    useChatDrafts.getState().addAttachments(KEY, [pending('a', 'processing')]);
    useAttachSendDialog.getState().open(KEY);
    renderDialog();

    const send = screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.title).toBe(ui.chat.attachWaitProcessing);
    expect(screen.getByText(ui.chat.attachProcessing)).toBeTruthy();
    // Процента на строке нет — вторая фаза не выдаёт себя за загрузку.
    expect(screen.queryByText('40%')).toBeNull();
  });
});

describe('attach-send-dialog: дроп в открытое окно (#716)', () => {
  it('дроп файла добавляет его в текущий черновик, оверлей-подсказка живая', () => {
    // jsdom не умеет blob-URL: превью строки создаётся в uploadAttachment.
    const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:preview'),
      configurable: true,
    });
    try {
      useChatDrafts.getState().addAttachments(KEY, [pending('a')]);
      useAttachSendDialog.getState().open(KEY, '');
      renderDialog();

      const file = new File(['x'], 'дропнутый.csv', { type: 'text/csv' });
      const anchor = screen.getByText('a.csv');
      fireEvent.dragEnter(anchor, { dataTransfer: { types: ['Files'], files: [file] } });
      expect(screen.getByText(ui.chat.dropToAttach)).toBeTruthy();

      // Дроп на любую точку окна (событие всплывает до контейнера диалога).
      fireEvent.drop(anchor, { dataTransfer: { types: ['Files'], files: [file] } });

      expect(
        useChatDrafts.getState().drafts[KEY]?.attachments.map((item) => item.fileName),
      ).toEqual(['a.csv', 'дропнутый.csv']);
      expect(screen.queryByText(ui.chat.dropToAttach)).toBeNull();
    } finally {
      // Возвращаем встроенную реализацию: глобальный URL общий для файла.
      if (originalCreateObjectURL) {
        Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
      } else {
        delete (URL as unknown as Record<string, unknown>).createObjectURL;
      }
    }
  });
});
