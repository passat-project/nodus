import { invoke } from '@tauri-apps/api/core';

import type { PopupPayload } from '@nodus/contracts';

/**
 * Типизированные обёртки IPC мини-UI оболочки (локальный origin — команды
 * разрешены статической capability `shell-ui`). Схемы зеркалят Rust:
 * apps/desktop/src-tauri/src/{portal,bridge,popups}.rs — рассинхрон = баг.
 */

/** Состояние подключения к порталу (драйвер экрана «Адрес портала»). */
export type ConnectionState =
  | { status: 'idle'; savedAddress?: string | null }
  | { status: 'connecting' }
  | { status: 'offline'; address: string }
  | { status: 'needs-update'; address: string; serverName: string; minShellVersion: string }
  | { status: 'ready'; address: string; serverName: string };

export type UpdateOutcome =
  { status: 'up-to-date' } | { status: 'installing' } | { status: 'unavailable' };

export const shellApi = {
  getState: () => invoke<ConnectionState>('get_connection_state'),

  /** Валидирует адрес, сохраняет и пробует подключиться (fetch config). */
  connect: (address: string) => invoke<ConnectionState>('submit_portal_address', { address }),

  /** Повторить подключение к сохранённому адресу (офлайн-заглушка). */
  retry: () => invoke<ConnectionState>('retry_connection'),

  /** Запустить проверку и тихую установку обновления оболочки. */
  runUpdater: () => invoke<UpdateOutcome>('run_updater'),

  /** Смена сервера из меню трея: сбросить адрес, вернуться на экран подключения. */
  changeServer: () => invoke<void>('change_server'),
};

/** Данные попапа (pull из Rust после загрузки окна; автозакрытия нет —
 *  угасанием командует Rust-тикер по активности пользователя). Тема —
 *  прикладывается Rust-ом к payload (#305): мини-UI применяет её до рендера,
 *  в контракт web→shell она не входит. `fadeMs` — та же длительность таяния,
 *  что у Rust-таймера закрытия (#998): CSS не держит вторую константу. */
export type PopupData = PopupPayload & { theme?: 'light' | 'dark'; fadeMs?: number };
