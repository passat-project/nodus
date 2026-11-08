import { errorMessages, ErrorCode, ui } from '@nodus/contracts';
import { toast } from 'sonner';

import { ApiError } from '../api-client.js';
import { isNumberConfirmCancelled, numberingErrorText } from '../custom-fields/number-confirm.js';

/** Тост ошибки мутации: русская строка по коду ошибки из словаря (I15:
 * `message` в ответе — английский технический, пользователю — строка по
 * `code`), фолбэк — общая строка «не удалось». Отказ выдачи номера (#630)
 * — с причиной («не лежит в папке вида «Комплект»»); «Вернуться и
 * заполнить» в окне пустого поля номера — без тоста. */
export function toastApiError(error: unknown): void {
  if (isNumberConfirmCancelled(error)) return;
  const code = error instanceof ApiError ? error.code : undefined;
  const message =
    numberingErrorText(error) ?? (code ? errorMessages[code as ErrorCode] : undefined);
  toast.error(message ?? ui.common.sendError);
}
