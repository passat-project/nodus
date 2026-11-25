import { useEffect, useState } from 'react';
import { DOWNLOADS_REGISTRY_LIMIT, type DownloadEntry } from '@nodus/contracts';

import {
  desktopDownloadReveal,
  desktopDownloadsList,
  isDesktopShell,
  registerDownloadsListener,
} from './desktop-bridge.js';

/**
 * Реестр загрузок оболочки (эпик #1038) для панели портала: стартовый список
 * командой `downloads_list` (оболочка помнит загрузки между запусками) плюс
 * живые записи событием `download-finished` через слушателей моста — новая
 * запись наверх, дедуп по id, потолок `DOWNLOADS_REGISTRY_LIMIT` (зеркало
 * реестра оболочки: новые вытесняют старейшие). Вне оболочки — пустой
 * готовый реестр (панель рисуется только в оболочке, хук всё равно честен).
 */
export function useDownloadsRegistry(): {
  entries: DownloadEntry[];
  ready: boolean;
  reveal: (path: string) => Promise<boolean>;
} {
  const inShell = isDesktopShell();
  const [entries, setEntries] = useState<DownloadEntry[]>([]);
  const [ready, setReady] = useState(!inShell);

  useEffect(() => {
    if (!inShell) return;
    let alive = true;
    // Стартовый список: команда старой оболочки недоступна — null, пусто.
    void desktopDownloadsList().then((list) => {
      if (!alive) return;
      if (list) setEntries(list.slice(0, DOWNLOADS_REGISTRY_LIMIT));
      setReady(true);
    });
    const unregister = registerDownloadsListener((entry) => {
      setEntries((prev) =>
        [entry, ...prev.filter((e) => e.id !== entry.id)].slice(0, DOWNLOADS_REGISTRY_LIMIT),
      );
    });
    return () => {
      alive = false;
      unregister();
    };
  }, [inShell]);

  return { entries, ready, reveal: desktopDownloadReveal };
}
