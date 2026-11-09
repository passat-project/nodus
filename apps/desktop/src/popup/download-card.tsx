import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ui, type PopupDownload } from '@nodus/contracts';

const t = ui.desktop;

/** Карточка скачивания — информационная: уходит сама через 8 с, hover держит
 *  паузу (модель Telegram; чатовые попапы живут по активности пользователя). */
const AUTO_HIDE_MS = 8000;

/** Иконка скачивания: стрелка в лоток, тот же тонкий штрих, что у остальных
 *  глифов мини-UI (библиотеки иконок в оболочке нет). */
function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3v11" />
      <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
      <path d="M4 16.5v2.2c0 .7.6 1.3 1.3 1.3h13.4c.7 0 1.3-.6 1.3-1.3v-2.2" />
    </svg>
  );
}

/**
 * Карточка «Файл скачан» (#647): круг с иконкой, заголовок из i18n, имя файла
 * в две строки, «Показать в папке». Клик по карточке ничего не открывает —
 * цели в портале нет. Путь файла в JS не приходит: команда reveal берёт его
 * из payload попапа в Rust и заново проверяет каталог «Загрузки».
 */
export function DownloadCard({
  download,
  paused,
}: {
  download: PopupDownload;
  /** Курсор на карточке: автоскрытие на паузе (решает родитель). */
  paused: boolean;
}) {
  const autoHideLeft = useRef(AUTO_HIDE_MS);

  // Считаем ОСТАТОК, а не заново весь интервал: ушли курсором — карточка
  // доживает своё время.
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => void invoke('popup_close'), autoHideLeft.current);
    return () => {
      window.clearTimeout(timer);
      autoHideLeft.current = Math.max(0, autoHideLeft.current - (Date.now() - started));
    };
  }, [paused]);

  function reveal() {
    void invoke('popup_reveal_download').catch(() => undefined);
  }

  // Кружок центрируем по высоте карточки: строка с кнопкой делает контент
  // выше 56 px — при items-start под иконкой оставался провал (вердикт
  // владельца 10.11). В чатовом попапе аватар выглядит так же.
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2.5">
      <span className="bg-muted text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded-full">
        <DownloadIcon className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 pr-6">
          <span className="truncate text-[13px] leading-4 font-semibold">
            {download.success ? t.downloadTitle : t.downloadErrorTitle}
          </span>
        </span>
        <span className="text-muted-foreground mt-1 line-clamp-2 max-h-8 overflow-hidden text-[12px] leading-4 [overflow-wrap:anywhere]">
          {download.fileName}
        </span>
        {download.success ? (
          <button
            type="button"
            onClick={reveal}
            className="text-info mt-1 cursor-pointer text-[13px] leading-4 font-medium hover:underline"
          >
            {t.downloadShowInFolder}
          </button>
        ) : null}
      </span>
    </div>
  );
}
