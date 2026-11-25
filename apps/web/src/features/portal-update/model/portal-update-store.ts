import { create } from 'zustand';

import { compareVersions } from './compare-versions.js';
import { PORTAL_VERSION } from './portal-version.js';

/**
 * Детект обновления портала (#1038, фаза A): сверка версии ЭТОЙ сборки с
 * `/version.json` в корне раздачи (пишет vite-плагин `vite-portal-version`;
 * dev — middleware, прод/песочница — статика из dist). Ошибки молчат:
 * dev без файла и сетевые сбои — норма, проверка повторится триггером хука.
 */
interface PortalUpdateState {
  /** Версия из version.json — запоминается, когда она новее сборки. */
  latestVersion: string | null;
  updateAvailable: boolean;
  /** Сверить version.json с версией сборки; уже найденное не переспрашивать. */
  check: () => Promise<void>;
}

export const usePortalUpdateStore = create<PortalUpdateState>()((set, get) => ({
  latestVersion: null,
  updateAvailable: false,
  check: async () => {
    if (get().updateAvailable) return;
    try {
      const response = await fetch('/version.json', { cache: 'no-store' });
      if (!response.ok) return;
      const version = ((await response.json()) as { version?: unknown }).version;
      if (typeof version !== 'string' || compareVersions(version, PORTAL_VERSION) <= 0) return;
      set({ updateAvailable: true, latestVersion: version });
    } catch {
      // 404/битый JSON/обрыв сети — тихо: триггер хука повторит проверку.
    }
  },
}));
