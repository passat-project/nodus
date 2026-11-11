import { ui } from '@nodus/contracts';

import { apiUpload } from '../api-client.js';
import { isDomainMocked } from '../api/api-mock-config.js';
import { prepareAvatarFile } from './avatar-compress.js';

/**
 * Загрузка аватарок (#186): превалидация ДО старта (канон вложений — ошибка
 * инлайном, не после потраченного трафика) и multipart с полями ДО файла
 * (контракт @fastify/multipart, репро #57). Общая для бесед (chat) и профиля
 * сотрудника (directory): путь и домен-флаг передаются вызовом.
 *
 * Сжатие (#725): фото с телефона (4 МБ, 24 Мп) сервер отклонял пиксельным
 * потолком 4096² — здесь оно даунскейлится и перекодируется до отправки
 * (`avatar-compress.ts`); маленькие фото уходят как есть.
 */

export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

export type AvatarIssue = 'bad-format' | 'too-large' | 'not-image';

/** Чистая функция превалидации — детерминированный unit-тест. */
export function validateAvatarFile(file: File): AvatarIssue | null {
  // mime клиента — первичный фильтр; сервер решает по magic bytes.
  if (!file.type.startsWith('image/')) return 'not-image';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return 'bad-format';
  if (file.size > AVATAR_MAX_BYTES) return 'too-large';
  return null;
}

export function avatarIssueMessage(issue: AvatarIssue): string {
  if (issue === 'too-large') return ui.common.avatarTooLarge;
  if (issue === 'bad-format') return ui.common.avatarBadFormat;
  return ui.common.avatarBadFormat;
}

export interface AvatarUploadTarget {
  /** Маршрут мутации, принимает multipart (size до файла, затем file). */
  path: string;
  /** Домен для msw-обхода в полумоке (мок-режим перехватит запрос). */
  domain: 'chat' | 'directory';
}

/** Загрузка аватара: FormData(size, previewUrl, file) → ответ маршрута.
 *  previewUrl — мок-поле (objectURL как url в демо), живой контур игнорирует
 *  (и ссылку освобождаем, как у вложений #57). */
export async function uploadAvatar<T>(target: AvatarUploadTarget, file: File): Promise<T> {
  const prepared = await prepareAvatarFile(file);
  const objectUrl = URL.createObjectURL(prepared);
  const form = new FormData();
  form.append('size', String(prepared.size));
  form.append('previewUrl', objectUrl);
  form.append('file', prepared);
  try {
    return await apiUpload<T>(target.path, form, { mswBypassIfLive: target.domain });
  } finally {
    if (!isDomainMocked(target.domain)) URL.revokeObjectURL(objectUrl);
  }
}
