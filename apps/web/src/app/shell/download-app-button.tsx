import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';

import { desktopApplyUpdate } from '../../shared/desktop/desktop-bridge.js';
import { windowsInstallerUrl } from '../../shared/desktop/desktop-manifest.js';
import { useDesktopApp } from '../../shared/desktop/use-desktop-app.js';
import { formatDate } from '../../shared/lib/format.js';

const OPEN_DELAY_MS = 140;
const CLOSE_DELAY_MS = 200;

/**
 * Кнопка «Скачать приложение» в топбаре (#263, рядом с лупой): браузеру —
 * прямая загрузка NSIS-установщика, оболочке — точка обновления (пассивный
 * поток: скачано и ждёт решения пользователя). Наведение — попап: при
 * зелёной точке список изменений НОВОЙ версии (вертикальный скролл для
 * длинных), без обновления — «Новых версий нет», в браузере — только
 * скачивание. Нет манифеста `/desktop/` — кнопки нет.
 */
export function DownloadAppButton() {
  const { manifest, inShell, updateState, shellVersion } = useDesktopApp();
  const installerUrl = manifest ? windowsInstallerUrl(manifest) : null;
  const [open, setOpen] = useState(false);
  const enterTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(enterTimer.current);
      window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  // Кнопка в ОБОЛОЧКЕ — точка обновления (состояние из моста, локально и
  // мгновенно): НЕ ждём сетевого манифеста, иначе при первом открытии её
  // не было до завершения фетча (фидбек 09.10). Манифест нужен только для
  // текстов попапа (версия/изменения/скачивание). Браузер — fail-safe:
  // нет раздачи — нет кнопки.
  if (!inShell && (!manifest || !installerUrl)) return null;

  const updateReady = inShell && updateState.status === 'available';
  // Версия в попапе: браузер — последняя с сервера (её скачают); оболочка
  // без обновления — УСТАНОВЛЕННАЯ («Новых версий нет» рядом с чужой версией
  // с сервера читалось как «у вас 1.0.4», фидбек 09.10); при зелёной точке —
  // переход «текущая → новая».
  //
  // Целевую версию в оболочке берём ИЗ МОСТА (её и установит апдейтер):
  // веб-манифест в долгоживущем окне может быть старше — фетч один на
  // загрузку страницы, а оболочка узнаёт о выпуске своим апдейтером. Иначе
  // попап показывал «1.0.15 → 1.0.15» и чужой «что нового» (#739).
  const manifestVersion = manifest?.version ?? '';
  const targetVersion = (updateReady ? updateState.version : null) ?? manifestVersion;
  // Заметки/дата правдивы только у манифеста, совпавшего с целевой версией:
  // текст старого выпуска хуже, чем его отсутствие (#739).
  const manifestMatches = manifest !== null && manifest.version === targetVersion;
  const versionLine = updateReady
    ? targetVersion
      ? `${shellVersion ?? ''} → ${targetVersion}`.trim()
      : (shellVersion ?? '')
    : inShell
      ? (shellVersion ?? manifestVersion)
      : manifestVersion;
  const showDate = (!inShell || updateReady) && manifestMatches && Boolean(manifest?.pub_date);

  const downloading = inShell && updateState.status === 'downloading';
  const label = updateReady ? ui.topbar.updateApp : ui.topbar.downloadApp;

  const scheduleOpen = () => {
    window.clearTimeout(leaveTimer.current);
    enterTimer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };
  const scheduleClose = () => {
    window.clearTimeout(enterTimer.current);
    leaveTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {inShell ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            className="relative text-muted-foreground hover:bg-accent hover:text-foreground"
            onMouseEnter={scheduleOpen}
            onMouseLeave={scheduleClose}
            onClick={updateReady ? () => void desktopApplyUpdate() : undefined}
          >
            <Download className="size-4" strokeWidth={1.75} />
            {updateReady && (
              <span className="absolute top-1 right-1 size-2 rounded-full bg-success" />
            )}
          </Button>
        ) : (
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            className="relative text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <a
              href={installerUrl ?? undefined}
              download
              onMouseEnter={scheduleOpen}
              onMouseLeave={scheduleClose}
            >
              <Download className="size-4" strokeWidth={1.75} />
            </a>
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-3"
        onMouseEnter={() => window.clearTimeout(leaveTimer.current)}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {updateReady ? ui.topbar.updateAvailable : ui.topbar.downloadAppHint}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-label font-semibold text-foreground tabular-nums">
              {versionLine}
            </span>
            {showDate && manifest?.pub_date && (
              <span className="text-xs text-muted-foreground">{formatDate(manifest.pub_date)}</span>
            )}
          </div>

          {updateReady ? (
            <>
              {manifest && manifestMatches && manifest.notes && (
                <div
                  className="max-h-40 overflow-y-auto text-sm whitespace-pre-line text-muted-foreground"
                  data-no-scrollbar
                >
                  {manifest.notes}
                </div>
              )}
              <Button size="sm" className="self-start" onClick={() => void desktopApplyUpdate()}>
                {ui.topbar.updateAppRestart}
              </Button>
            </>
          ) : downloading ? (
            <div className="text-sm text-muted-foreground">
              {ui.topbar.updateDownloading}
              {updateState.version ? ` ${updateState.version}…` : '…'}
            </div>
          ) : inShell ? (
            <div className="text-sm text-muted-foreground">{ui.topbar.updateNone}</div>
          ) : (
            <Button asChild size="sm" className="self-start">
              <a href={installerUrl ?? undefined} download>
                {ui.topbar.downloadAppForWindows}
              </a>
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
