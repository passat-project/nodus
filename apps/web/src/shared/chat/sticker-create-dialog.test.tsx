// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import { StickerCreateDialog } from './sticker-create-dialog.js';

const mocks = vi.hoisted(() => ({
  create: vi.fn<(body: { title: string; scope: string }) => Promise<{ id: string }>>(),
  upload:
    vi.fn<(packId: string, input: { file: File; emojis: string[] }) => Promise<{ id?: string }>>(),
}));

vi.mock('./sticker-api.js', () => ({
  useCanManageStickerPacks: () => false,
  useCreateStickerPack: () => ({ mutateAsync: mocks.create }),
  uploadStickerFile: mocks.upload,
  stickerKeys: { packs: () => ['sticker-packs-test'] },
}));

vi.mock('./sticker-upload-rules.js', () => ({
  STICKER_ACCEPT: 'image/png',
  isWebmFile: () => false,
  probeStickerMedia: async () => ({ width: 1, height: 1, durationIssue: false }),
  validateStickerFile: () => null,
}));

vi.mock('./emoji-picker.js', () => ({
  EmojiPanel: ({ onPick }: { onPick: (emoji: string) => void }) => (
    <button type="button" onClick={() => onPick('😀')}>
      pick-emoji
    </button>
  ),
}));

vi.mock('./sticker-message.js', () => ({ StickerGlyph: () => null }));

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    value: vi.fn(() => 'blob:sticker-test'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  const onOpenChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <StickerCreateDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

async function pickFiles(count = 5) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const files = Array.from(
    { length: count },
    (_, i) => new File([`sticker-${i}`], `sticker-${i}.png`, { type: 'image/png' }),
  );
  fireEvent.change(input, { target: { files } });
  await waitFor(() =>
    expect(screen.queryAllByRole('button', { name: ui.chat.stickerAddEmoji })).toHaveLength(count),
  );
}

function fillForm(count = 5) {
  fireEvent.change(screen.getByLabelText(ui.chat.stickerPackTitle), {
    target: { value: 'Тестовый пак' },
  });
  for (let i = 0; i < count; i++) {
    fireEvent.click(screen.getAllByRole('button', { name: ui.chat.stickerAddEmoji })[i]!);
    fireEvent.click(screen.getByRole('button', { name: 'pick-emoji' }));
  }
}

describe('создание набора стикеров: повтор после сбоя (#866, AUD-030)', () => {
  it('сбой на третьем из пяти: повтор использует тот же набор и догружает только незагруженные', async () => {
    mocks.create.mockResolvedValue({ id: 'pack-1' });
    let calls = 0;
    mocks.upload.mockImplementation(async () => {
      calls++;
      if (calls === 3) throw new Error('upload failed');
      return { id: `sticker-${calls}` };
    });
    const onOpenChange = setup();
    await pickFiles();
    fillForm();

    fireEvent.click(screen.getByRole('button', { name: ui.chat.stickerUpload }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(3));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    // Окно осталось открытым для повтора.
    expect(screen.getByLabelText(ui.chat.stickerPackTitle)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: ui.chat.stickerUpload }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(6);
    const fileNames = mocks.upload.mock.calls.map(([, input]) => input.file.name);
    expect(new Set(fileNames)).toEqual(
      new Set([
        'sticker-0.png',
        'sticker-1.png',
        'sticker-2.png',
        'sticker-3.png',
        'sticker-4.png',
      ]),
    );
    const packIds = new Set(mocks.upload.mock.calls.map(([packId]) => packId));
    expect(packIds).toEqual(new Set(['pack-1']));
  });

  it('успешное создание с первого раза: один набор и пять стикеров', async () => {
    mocks.create.mockResolvedValue({ id: 'pack-success' });
    mocks.upload.mockResolvedValue({});
    const onOpenChange = setup();
    await pickFiles();
    fillForm();

    fireEvent.click(screen.getByRole('button', { name: ui.chat.stickerUpload }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(5);
    expect(new Set(mocks.upload.mock.calls.map(([packId]) => packId))).toEqual(
      new Set(['pack-success']),
    );
  });

  it('закрытие окна после сбоя не создаёт второй набор', async () => {
    mocks.create.mockResolvedValue({ id: 'pack-close' });
    let calls = 0;
    mocks.upload.mockImplementation(async () => {
      calls++;
      if (calls === 3) throw new Error('upload failed');
      return {};
    });
    const onOpenChange = setup();
    await pickFiles();
    fillForm();

    fireEvent.click(screen.getByRole('button', { name: ui.chat.stickerUpload }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole('button', { name: ui.common.cancel }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.upload).toHaveBeenCalledTimes(3);
  });
});
