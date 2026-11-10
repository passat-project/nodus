// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageAttachment } from '@nodus/contracts';

const { apiMock, uploadMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  uploadMock: vi.fn(),
}));

vi.mock('../api-client.js', () => ({ api: apiMock, apiUpload: uploadMock }));

import { useChatDrafts } from './chat-drafts.js';
import { addFiles, cancelUpload, PROCESSING_HINT_MS } from './composer-files.js';
import { useAttachSendDialog } from './dialog-stores.js';

/**
 * Двухфазная загрузка (#717): прогресс = байты, принятые сервером; ответ 201
 * приходит ПОСЛЕ записи в хранилище (80 МБ ≈ 2–3 с). Между фазами — состояние
 * `processing`, которое показывается только если пауза заметна (порог), а
 * снятая в этой фазе строка не теряет готовое вложение на сервере.
 */

const KEY = 'conversation:22222222-2222-4222-8222-222222222222';

const DTO: MessageAttachment = {
  id: 'att-1',
  fileId: 'file-1',
  name: 'отчёт.csv',
  size: 5,
  mime: 'text/csv',
  kind: 'file',
  url: null,
  thumbnailUrl: null,
  previewKind: 'file',
  pdfUrl: null,
  width: null,
  height: null,
};

let resolveUpload: (attachment: MessageAttachment) => void = () => undefined;
/** Встроенная (Node) реализация blob-URL: jsdom File для неё не Blob — в
 *  тестах подменяем, а после каждого обязаны вернуть как было (глобальный
 *  URL общий для файла тестов). */
let originalCreateObjectURL: PropertyDescriptor | undefined;

function row() {
  return useChatDrafts.getState().drafts[KEY]?.attachments[0];
}

/** Колбэк прогресса настоящей загрузки: так его получает apiUpload. */
function progress(fraction: number): void {
  const options = uploadMock.mock.calls[0]?.[2] as { onProgress: (value: number) => void };
  options.onProgress(fraction);
}

beforeEach(() => {
  vi.useFakeTimers();
  useChatDrafts.setState({ drafts: {} });
  useAttachSendDialog.setState({ scope: null, caption: '' });
  uploadMock.mockReset();
  uploadMock.mockImplementation(
    () =>
      new Promise<MessageAttachment>((resolve) => {
        resolveUpload = resolve;
      }),
  );
  apiMock.mockReset();
  apiMock.mockResolvedValue({});
  // jsdom не умеет blob-URL, а превью строки создаётся в uploadAttachment.
  originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:preview'),
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
  } else {
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
  }
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
});

function startUpload(): void {
  addFiles(KEY, [new File(['bytes'], 'отчёт.csv', { type: 'text/csv' })]);
  expect(row()?.status).toBe('uploading');
}

describe('composer-files: фаза «Обработка…» (#717)', () => {
  it('тело принято, ответа нет — processing включается только после порога', async () => {
    startUpload();

    progress(1);
    // Порог не истёк: состояние ещё не мигает (малые файлы не дрожат).
    vi.advanceTimersByTime(PROCESSING_HINT_MS - 1);
    expect(row()?.status).toBe('uploading');

    vi.advanceTimersByTime(1);
    expect(row()?.status).toBe('processing');

    resolveUpload(DTO);
    await vi.advanceTimersByTimeAsync(0);
    expect(row()?.status).toBe('ready');
    expect(row()?.attachment?.id).toBe('att-1');
  });

  it('быстрый ответ сервера: «Обработка…» не показывается вовсе', async () => {
    startUpload();
    progress(1);
    resolveUpload(DTO);
    await vi.advanceTimersByTimeAsync(0);
    expect(row()?.status).toBe('ready');

    // Опоздавший таймер погашен — готовую строку в processing не вернуть.
    vi.advanceTimersByTime(PROCESSING_HINT_MS * 2);
    expect(row()?.status).toBe('ready');
  });

  it('снятие строки в фазе обработки: вложение дочитывается и удаляется на сервере', async () => {
    startUpload();
    progress(1);
    vi.advanceTimersByTime(PROCESSING_HINT_MS);
    const localId = row()?.localId as string;
    expect(row()?.status).toBe('processing');

    // Отмена в этой фазе НЕ абортит запрос (abort потерял бы id вложения).
    cancelUpload(KEY, localId);
    expect(useChatDrafts.getState().drafts[KEY]?.attachments ?? []).toHaveLength(0);
    expect(apiMock).not.toHaveBeenCalled();

    resolveUpload(DTO);
    await vi.advanceTimersByTimeAsync(0);
    expect(apiMock).toHaveBeenCalledWith('/chat/attachments/att-1', { method: 'DELETE' });
  });
});
