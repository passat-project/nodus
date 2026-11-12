// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiUpload: vi.fn(async () => ({ ok: true })),
  // Подготовка файла подменена: задача теста — контракт запроса, сжатие
  // проверяется в avatar-compress.test.ts.
  prepareAvatarFile: vi.fn(async (file: File) => file),
}));
const { apiUpload, prepareAvatarFile } = mocks;

vi.mock('../api-client.js', () => ({ apiUpload: mocks.apiUpload }));
vi.mock('./avatar-compress.js', () => ({ prepareAvatarFile: mocks.prepareAvatarFile }));
vi.mock('../api/api-mock-config.js', () => ({ isDomainMocked: () => false }));

import { uploadAvatar } from './avatar-upload.js';

/**
 * Загрузка аватара (#725): на сервер уходит ПОДГОТОВЛЕННЫЙ файл (клиентское
 * сжатие), размер в форме — фактический у подготовленного, objectURL
 * освобождается в живом режиме; mock-режим ссылку не трогает (она — url для
 * демо-данных).
 */

const file = (size = 1024): File =>
  new File([new Uint8Array(size)], 'photo.jpg', { type: 'image/jpeg' });

function formOf(call: unknown[]): FormData {
  return call[1] as FormData;
}

describe('uploadAvatar (#725)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('отправляет подготовленный файл: size — фактический, поля ДО файла (#57)', async () => {
    const compressed = new File([new Uint8Array(2048)], 'photo.webp', { type: 'image/webp' });
    prepareAvatarFile.mockResolvedValueOnce(compressed);

    await uploadAvatar({ path: '/directory/users/me/avatar', domain: 'directory' }, file(4096));

    expect(prepareAvatarFile).toHaveBeenCalledTimes(1);
    const form = formOf(apiUpload.mock.calls[0] as unknown[]);
    expect(form.get('size')).toBe('2048');
    expect((form.get('file') as File).name).toBe('photo.webp');
    expect(form.get('previewUrl')).toBe('blob:preview');
    // Порядок полей контракта @fastify/multipart: текст до файла.
    expect([...form.keys()]).toEqual(['size', 'previewUrl', 'file']);
  });

  it('не сжалось (маленькое фото) — уходит исходный файл как есть', async () => {
    const original = file(200 * 1024);
    prepareAvatarFile.mockResolvedValueOnce(original);

    await uploadAvatar({ path: '/chat/conversations/1/avatar', domain: 'chat' }, original);

    const form = formOf(apiUpload.mock.calls[0] as unknown[]);
    expect((form.get('file') as File).size).toBe(200 * 1024);
    expect(form.get('size')).toBe(String(200 * 1024));
  });

  it('живой контур: objectURL освобождается после ответа', async () => {
    await uploadAvatar({ path: '/directory/users/me/avatar', domain: 'directory' }, file());

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('сбой загрузки не течёт objectURL — освобождение в finally', async () => {
    apiUpload.mockRejectedValueOnce(new Error('boom'));

    await expect(
      uploadAvatar({ path: '/directory/users/me/avatar', domain: 'directory' }, file()),
    ).rejects.toThrow('boom');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });
});
