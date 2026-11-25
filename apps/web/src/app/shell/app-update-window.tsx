import { X } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@nodus/ui/components/dialog';

import { desktopApplyUpdate } from '../../shared/desktop/desktop-bridge.js';
import { useDesktopApp } from '../../shared/desktop/use-desktop-app.js';
import { LogoIcon } from './logo-icon.js';

/**
 * Центральное окно «Приложение Nodus» (#1038, фаза B2): вход из панели
 * оболочка (знак Nodus). Заменяет в оболочке попап кнопки «Скачать
 * приложение»: версия, состояние автообновления и заметки выпуска — те же
 * данные, что у DownloadAppButton (`useDesktopApp` + манифест раздачи);
 * установка — тот же вызов моста `desktopApplyUpdate`.
 */
export function AppUpdateWindow({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { manifest, updateState, shellVersion } = useDesktopApp();
  const updateReady = updateState.status === 'available';
  const downloading = updateState.status === 'downloading';
  // Целевая версия — из моста (её и установит апдейтер); заметки/версия
  // правдивы только у манифеста, совпавшего с ней (#739).
  const targetVersion = updateReady ? updateState.version : null;
  const manifestMatches =
    manifest !== null && targetVersion !== null && manifest.version === targetVersion;
  const currentVersion = shellVersion ?? manifest?.version ?? '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-[480px]">
        <div className="flex items-start justify-between gap-2 pr-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <LogoIcon className="size-5 shrink-0 text-foreground" />
            <DialogTitle className="truncate">{ui.desktop.panelAppTitle}</DialogTitle>
          </div>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={ui.desktop.panelAppClose}
              title={ui.desktop.panelAppClose}
              className="absolute top-3 right-3 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X strokeWidth={1.75} />
            </Button>
          </DialogClose>
        </div>
        <DialogDescription className="sr-only">{ui.desktop.panelAppVersion}</DialogDescription>

        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground">{ui.desktop.panelAppVersion}</span>
            <span className="font-mono text-label font-semibold text-foreground tabular-nums">
              {currentVersion}
            </span>
          </div>

          {updateReady ? (
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground">
                {ui.desktop.panelAppUpdateAvailable}
              </span>
              <span className="font-mono text-label font-semibold text-success tabular-nums">
                {targetVersion}
              </span>
            </div>
          ) : (
            <div className="mt-1 text-sm text-muted-foreground">{ui.desktop.panelAppNoUpdates}</div>
          )}
        </div>

        {updateReady && manifestMatches && manifest?.notes ? (
          <div className="flex flex-col gap-1.5">
            <div className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {ui.desktop.panelAppNotes}
            </div>
            {/* Многострочный «что нового» — параграфами: пустая строка
                разделяет абзацы, одиночный перенос живёт внутри абзаца. */}
            <div className="max-h-56 overflow-y-auto text-sm text-muted-foreground">
              {manifest.notes
                .split(/\n{2,}/)
                .filter((paragraph) => paragraph.trim() !== '')
                .map((paragraph, index) => (
                  <p key={index} className="mb-2 last:mb-0 whitespace-pre-line">
                    {paragraph}
                  </p>
                ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-row justify-end">
          {updateReady ? (
            <Button onClick={() => void desktopApplyUpdate()}>
              {ui.desktop.panelAppUpdateDownload}
            </Button>
          ) : downloading ? (
            <Button disabled>{ui.desktop.panelAppUpdateDownloading}</Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
