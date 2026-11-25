import { Download } from 'lucide-react';
import { useState } from 'react';
import { ui, type DownloadEntry } from '@nodus/contracts';
import { Badge } from '@nodus/ui/components/badge';
import { Button } from '@nodus/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';

import { useDownloadsRegistry } from '../../shared/desktop/use-downloads-registry.js';
import { formatListTimestamp } from '../../shared/lib/format.js';

/** Ровно тот же калибр и ховер, что у PanelIconButton панели (там компонент
 *  локальный — свой триггер с той же геометрией, без цикла импортов).
 *  Нативная button вместо shadcn-Button: у ghost/icon-sm своя геометрия —
 *  ховер выпадал из общего ритма правого кластера (вердикт владельца 25.11). */
const PANEL_BUTTON_CLASS =
  'relative flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

/**
 * Кнопка «Загрузки» панели оболочки (эпик #1038): поповер с реестром
 * загрузок — последние наверх, у успешных кнопка «Показать в папке» (мост,
 * гвард каталога в Rust), у неуспешных — бейдж «Не удалось скачать».
 * Пусто (или старая оболочка без команды реестра) — «Пока ничего не
 * скачивали»: показываем только после ответа моста, без вспышки пустоты.
 */
export function DownloadsPopoverButton() {
  const { entries, ready, reveal } = useDownloadsRegistry();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ui.desktop.panelDownloads}
          title={ui.desktop.panelDownloads}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={PANEL_BUTTON_CLASS}
        >
          <Download className="size-4" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {ui.desktop.downloadsTitle}
          </div>
          {entries.length > 0 ? (
            <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto" data-no-scrollbar>
              {entries.map((entry) => (
                <DownloadRow
                  key={entry.id}
                  entry={entry}
                  onReveal={() => void reveal(entry.path)}
                />
              ))}
            </div>
          ) : ready ? (
            <div className="py-3 text-center text-sm text-muted-foreground">
              {ui.desktop.downloadsEmpty}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Строка реестра: имя файла (сверхдлинное — truncate с тултипом), время
 *  завершения (моно — данные) и действие по итогу загрузки. */
function DownloadRow({ entry, onReveal }: { entry: DownloadEntry; onReveal: () => void }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg px-2 py-1.5">
      <div className="truncate text-sm text-foreground" title={entry.fileName}>
        {entry.fileName}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatListTimestamp(new Date(entry.finishedAtMs).toISOString())}
        </span>
        {entry.success && entry.path ? (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onReveal}>
            {ui.desktop.downloadsShowInFolder}
          </Button>
        ) : !entry.success ? (
          <Badge variant="destructive">{ui.desktop.downloadFailedShort}</Badge>
        ) : null}
      </div>
    </div>
  );
}
