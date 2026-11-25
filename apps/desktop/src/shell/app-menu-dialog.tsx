import { useEffect, useState } from 'react';
import { ui, type ShellUpdateState } from '@nodus/contracts';

import { shellApi, type UpdateOutcome } from './shell-ipc.js';

const t = ui.desktop;

/**
 * Мини-окно «Приложение» (кнопка панели, эпик #1038): версия оболочки и
 * состояние обновления — та же пассивная модель, что у экрана «обновите
 * приложение» (#263): скачивание и установка — только по решению
 * пользователя. Вынесено из shell-panel (лимит строк, I5).
 */
export function AppMenuDialog({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<ShellUpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);

  useEffect(() => {
    void shellApi
      .getShellInfo()
      .then((info) => setVersion(info.version))
      .catch(() => setVersion(null));
    void shellApi
      .getUpdateState()
      .then(setUpdate)
      .catch(() => setUpdate(null));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function install() {
    setBusy(true);
    // run_updater скачивает и ставит обновление с перезапуском оболочки;
    // недоступность манифеста — единственный безыдейный исход.
    setOutcome(await shellApi.runUpdater().catch(() => ({ status: 'unavailable' as const })));
    setBusy(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.panelAppTitle}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="bg-card text-foreground relative w-full max-w-sm rounded-[14px] border p-6 shadow-lg">
        <button
          type="button"
          aria-label={t.panelAppClose}
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground absolute right-3 top-3 flex h-9 w-9 items-center justify-center text-sm"
        >
          ✕
        </button>
        <h2 className="text-lg font-semibold">{t.panelAppTitle}</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {t.panelAppVersion}: {version ?? '…'}
        </p>
        <div className="mt-4">
          {busy ? (
            <p className="text-muted-foreground text-sm">{t.panelAppUpdateDownloading}</p>
          ) : update?.status === 'available' ? (
            <>
              <p className="text-sm">
                {t.panelAppUpdateAvailable}
                {update.version ? ` — ${update.version}` : ''}
              </p>
              <button
                type="button"
                onClick={() => void install()}
                className="bg-primary text-primary-foreground mt-3 h-9 rounded-[10px] px-4 text-sm font-medium"
              >
                {t.panelAppUpdateDownload}
              </button>
            </>
          ) : update?.status === 'downloading' ? (
            <p className="text-muted-foreground text-sm">{t.panelAppUpdateDownloading}</p>
          ) : outcome?.status === 'unavailable' ? (
            <p className="text-warning text-sm">{t.updateUnavailable}</p>
          ) : (
            <p className="text-muted-foreground text-sm">{t.panelAppNoUpdates}</p>
          )}
        </div>
      </section>
    </div>
  );
}
