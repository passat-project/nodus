import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ui, type PopupDownload } from '@nodus/contracts';

import { DownloadIcon, FolderIcon } from '../shell/icons.js';
import { PopupCloseButton } from './popup-close-button.js';

const t = ui.desktop;

/** Карточка скачивания — информационная: уходит сама через 8 с, hover держит
 *  паузу (модель Telegram; чатовые попапы живут по активности пользователя).
 *  Серия (#1038): каждый новый файл перезапускает отсчёт заново. */
const AUTO_HIDE_MS = 8000;

/**
 * Карточка «Файл скачан» (#647, #1038) — того же размера, что обычная карточка
 * уведомления (вердикт владельца 27.11.2026, #1068): ширина окна общая, контент
 * по высоте аватара обычной карточки (`min-h-14` = 3.5rem) — окно совпадает по
 * высоте с чатовым попапом. Строка одна и стоит по центру карточки: глиф
 * скачивания · «Файл скачан» / «Скачано: N» / ошибка · имя файла (truncate,
 * тултип) · иконка папки «Показать в папке» · крестик. Крестик — последний
 * элемент строки, а не абсолютный по окну: его уровень одинаков в любом
 * состоянии и серии (карточки подряд — крестики на одной линии). Неуспех —
 * красный заголовок, папки нет. Путь файла в JS не приходит: команда reveal
 * берёт его из серии в Rust и заново проверяет каталог «Загрузки». Клик по
 * карточке ничего не открывает — цели в портале нет.
 *
 * Состояние загрузки (#1069, вердикт владельца): пока файл качается, та же
 * карточка показывает «Скачивается», проценты и тонкую полоску по нижней
 * кромке (реальный прогресс из WebView2; размер неизвестен — бегущая полоска);
 * автоскрытие на это время выключено, кнопки папки нет. По завершении payload
 * меняется на серию — карточка плавно становится «Файл скачан», полоска уходит.
 */
export function DownloadCard({
  download,
  paused,
  autoHideMs,
  onClose,
  progress,
}: {
  download: PopupDownload;
  /** Курсор на карточке или окно Nodus неактивно: автоскрытие на паузе. */
  paused: boolean;
  /** Автоскрытие из payload (единый источник с Rust, как fadeMs). */
  autoHideMs: number;
  /** Крестик — в строке (общий с чатовой карточкой компонент). */
  onClose: () => void;
  /** Живой прогресс 0..100 из Rust (#1069): перекрывает значение payload;
   *  null/undefined — размер неизвестен (бегущая полоска). */
  progress?: number | null;
}) {
  // Старый payload без счётчика (до #1038) — считаем одиночной загрузкой.
  const count = download.count ?? 1;
  const downloading = download.state === 'downloading';
  const title = downloading
    ? t.downloadInProgress
    : !download.success
      ? t.downloadFailedShort
      : count > 1
        ? t.downloadCount.replace('{count}', String(count))
        : t.downloadTitle;
  const livePercent = progress ?? download.progress;
  const percentKnown = typeof livePercent === 'number' && Number.isFinite(livePercent);
  const percent = percentKnown ? Math.min(100, Math.max(0, Math.round(livePercent))) : 0;
  const seriesKey = `${download.success}|${count}|${download.fileName}`;
  const fullMs = autoHideMs > 0 ? autoHideMs : AUTO_HIDE_MS;
  const autoHideLeft = useRef(fullMs);

  // Считаем ОСТАТОК, а не заново весь интервал: ушли курсором — карточка
  // доживает своё время. Смена файла серии — единственный повод начать
  // отсчёт заново (#1038); объявлен ДО таймера, чтобы на смене серии
  // сброс успевал отработать раньше перезапуска. Конец загрузки (#1069)
  // даёт свежие 8 с — пока файл качается, отсчёт стоит.
  useEffect(() => {
    autoHideLeft.current = fullMs;
  }, [seriesKey, fullMs, downloading]);

  useEffect(() => {
    if (paused || downloading) return;
    const started = Date.now();
    const timer = window.setTimeout(() => void invoke('popup_close'), autoHideLeft.current);
    return () => {
      window.clearTimeout(timer);
      autoHideLeft.current = Math.max(0, autoHideLeft.current - (Date.now() - started));
    };
  }, [paused, seriesKey, downloading]);

  function reveal() {
    void invoke('popup_reveal_download').catch(() => undefined);
  }

  return (
    <>
      {/* Строка по центру карточки: высота контента = аватару обычной карточки
          (min-h-14), поэтому окно и видимые поля такие же, как у уведомления. */}
      <div className="flex min-h-14 min-w-0 items-center gap-2">
        <DownloadIcon className="text-muted-foreground size-4 shrink-0" />
        {/* Имя файла в той же строке после «·»: понятно, ЧТО скачано; длинное
            имя — truncate с тултипом. */}
        <span className="min-w-0 flex-1 truncate text-[13px] leading-4" title={download.fileName}>
          <span className={download.success ? 'font-semibold' : 'text-destructive font-semibold'}>
            {title}
          </span>
          {download.success && download.fileName ? (
            <span className="text-muted-foreground"> · {download.fileName}</span>
          ) : null}
        </span>
        {/* Проценты — только пока файл идёт и размер известен (#1069). */}
        {downloading && percentKnown ? (
          <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
            {percent}%
          </span>
        ) : null}
        {/* Папки нет, пока файл не завершён: открывать нечего. */}
        {download.success && !downloading ? (
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
        <PopupCloseButton onClose={onClose} />
      </div>
      {/* Полоска прогресса по нижней кромке: не меняет высоту карточки и
          уровень крестика (#1068); заполнение — по байтам, без размера —
          бегущая. */}
      {downloading ? (
        <div
          data-download-progress
          className="bg-muted absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
          aria-hidden
        >
          {percentKnown ? (
            <div
              className="bg-primary h-full transition-[width] duration-200 ease-out"
              style={{ width: `${percent}%` }}
            />
          ) : (
            <div className="bg-primary popup-progress-run h-full w-1/3" />
          )}
        </div>
      ) : null}
    </>
  );
}
