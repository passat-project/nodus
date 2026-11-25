import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ui, type PopupDownload } from '@nodus/contracts';

import { DownloadIcon, FolderIcon } from '../shell/icons.js';

const t = ui.desktop;

/** Карточка скачивания — информационная: уходит сама через 8 с, hover держит
 *  паузу (модель Telegram; чатовые попапы живут по активности пользователя).
 *  Серия (#1038): каждый новый файл перезапускает отсчёт заново. */
const AUTO_HIDE_MS = 8000;

/**
 * Карточка «Файл скачан» (#647, #1038) — КОМПАКТНАЯ ОДНОСТРОЧНАЯ (вердикт
 * владельца 25.11: круглый аватар был пародией на чатовые попапы, высота не
 * нужна; калибр — как у коллаута обновления портала): глиф скачивания ·
 * «Файл скачан» / «Скачано: N» / ошибка · имя файла (truncate, тултип) ·
 * иконка папки «Показать в папке» (кнопка без текста — не раздувает высоту).
 * Неуспех — красный заголовок, папки нет. Путь файла в JS не приходит:
 * команда reveal берёт его из серии в Rust и заново проверяет каталог
 * «Загрузки». Клик по карточке ничего не открывает — цели в портале нет.
 */
export function DownloadCard({
  download,
  paused,
  autoHideMs,
}: {
  download: PopupDownload;
  /** Курсор на карточке или окно Nodus неактивно: автоскрытие на паузе. */
  paused: boolean;
  /** Автоскрытие из payload (единый источник с Rust, как fadeMs). */
  autoHideMs: number;
}) {
  // Старый payload без счётчика (до #1038) — считаем одиночной загрузкой.
  const count = download.count ?? 1;
  const title = !download.success
    ? t.downloadFailedShort
    : count > 1
      ? t.downloadCount.replace('{count}', String(count))
      : t.downloadTitle;
  const seriesKey = `${download.success}|${count}|${download.fileName}`;
  const fullMs = autoHideMs > 0 ? autoHideMs : AUTO_HIDE_MS;
  const autoHideLeft = useRef(fullMs);

  // Считаем ОСТАТОК, а не заново весь интервал: ушли курсором — карточка
  // доживает своё время. Смена файла серии — единственный повод начать
  // отсчёт заново (#1038); объявлен ДО таймера, чтобы на смене серии
  // сброс успевал отработать раньше перезапуска.
  useEffect(() => {
    autoHideLeft.current = fullMs;
  }, [seriesKey, fullMs]);

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => void invoke('popup_close'), autoHideLeft.current);
    return () => {
      window.clearTimeout(timer);
      autoHideLeft.current = Math.max(0, autoHideLeft.current - (Date.now() - started));
    };
  }, [paused, seriesKey]);

  function reveal() {
    void invoke('popup_reveal_download').catch(() => undefined);
  }

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 pr-6">
      <DownloadIcon className="text-muted-foreground size-4 shrink-0" />
      {/* Имя файла в той же строке после «·»: понятно, ЧТО скачано, высота
          при этом однострочная; сверхдлинное имя — truncate с тултипом. */}
      <span className="min-w-0 flex-1 truncate text-[13px] leading-4" title={download.fileName}>
        <span className={download.success ? 'font-semibold' : 'text-destructive font-semibold'}>
          {title}
        </span>
        {download.success && download.fileName ? (
          <span className="text-muted-foreground"> · {download.fileName}</span>
        ) : null}
      </span>
      {download.success ? (
        <button
          type="button"
          onClick={reveal}
          aria-label={t.downloadShowInFolder}
          title={t.downloadShowInFolder}
          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md"
        >
          <FolderIcon className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
