import { useEffect, useState } from 'react';
import { ui, type DownloadEntry } from '@nodus/contracts';

import { shellApi } from './shell-ipc.js';

const t = ui.desktop;

/** Метка времени записи реестра: день.месяц часы:минуты (язык интерфейса один — ru). */
const finishedAtFmt = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Поповер «Загрузки» (эпик #1038, раздел 5): реестр последних завершённых
 * загрузок оболочки — память между запусками (downloads.json в Rust), новые
 * сверху. «Показать в папке» — только у успешных записей с путём; гвард
 * каталога «Загрузки» выполняет Rust-сторона команды. Вынесено из
 * shell-panel (лимит строк, I5).
 */
export function DownloadsPopover({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<DownloadEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    void shellApi
      .downloadsList()
      .then((list) => {
        if (alive) setEntries(list);
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Невидимый фон: клик/выбор мимо списка закрывает поповер. */}
      <div className="fixed inset-0" onMouseDown={onClose} />
      <section
        role="dialog"
        aria-label={t.downloadsTitle}
        className="bg-card text-foreground absolute right-0 top-full z-50 mt-1 max-h-[320px] w-80 overflow-y-auto rounded-[10px] border py-1 shadow-lg"
      >
        {entries === null ? (
          <p className="text-muted-foreground px-3 py-2 text-sm">…</p>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground px-3 py-2 text-sm">{t.downloadsEmpty}</p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="hover:bg-muted flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm leading-snug" title={entry.fileName}>
                  {entry.fileName}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                  {entry.success
                    ? finishedAtFmt.format(new Date(entry.finishedAtMs))
                    : t.downloadFailedShort}
                </p>
              </div>
              {entry.success && entry.path ? (
                <button
                  type="button"
                  onClick={() => void shellApi.downloadReveal(entry.path)}
                  className="text-muted-foreground hover:text-foreground h-7 shrink-0 rounded-[8px] px-2 text-xs"
                >
                  {t.downloadsShowInFolder}
                </button>
              ) : null}
            </div>
          ))
        )}
      </section>
    </>
  );
}
