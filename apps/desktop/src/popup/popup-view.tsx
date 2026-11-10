import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ui } from '@nodus/contracts';

import type { PopupData } from '../shell/shell-ipc.js';
import { DownloadCard } from './download-card.js';

const t = ui.desktop;

/** Гексагон отправки — зеркало web/shared/ui/send-hex-icon.tsx (канон
 *  композера, вердикт 24.09): мини-UI оболочки не импортирует web-код. */
function SendHexIcon({ className }: { className?: string }) {
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
      <polygon points="12,2.8 20,7.4 20,16.6 12,21.2 4,16.6 4,7.4" />
    </svg>
  );
}

/** Фаза угасания: Rust-тикер решает КОГДА, CSS здесь — плавность. */
type FadePhase = 'idle' | 'fading' | 'reset';

/**
 * Попап уведомления (ADR-0019 п.4, канон Telegram Desktop по фидбеку 08.10):
 * клик по карточке — открыть беседу; «Ответить» — маленькая кнопка, проявляется
 * на hover ПОВЕРХ контента; поле ответа — мягкое, без рамок, в одну строку с
 * гексагоном внутри; активность пользователя (клик/клавиша) медленно гасит
 * попап (~3 c), hover возвращает; неактивен — висит неограниченно.
 *
 * Геометрия окна — ПО ФАКТУ контента (#406): карточка измеряет себя после
 * рендера и шлёт `popup_set_height`; оболочка раскладывает стек по этим
 * высотам. Захардкоженные «88/124» разъезжались с ui-scale (rem-утилиты
 * наследуют --ui-scale 1.25) — поле ответа вырастало за окно. Скролла нет:
 * `overflow: clip` (а не hidden) делает карточку НЕ-scroll-контейнером —
 * фокус поля не может прокрутить её вверх и спрятать крестик.
 */
export function PopupView() {
  const [data, setData] = useState<PopupData | null>(null);
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [fade, setFade] = useState<FadePhase>('idle');
  /** Первая измеренная высота применена — можно показывать окно. */
  const [measured, setMeasured] = useState(false);
  /** Курсор на карточке скачивания: автоскрытие на паузе. */
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const reportedHeight = useRef(0);

  // Прозрачное окно + запрет скролла: впритык-геометрия на дробном DPI даёт
  // субпиксельное переполнение — глушим на корне (фидбек 08.10). `clip`, а не
  // `hidden`: hidden остаётся scroll-контейнером, и scroll-into-view фокуса
  // уводит содержимое за верхнюю границу (#406).
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.documentElement.style.overflow = 'clip';
    document.body.style.overflow = 'clip';
  }, []);

  // Pull-модель: окно забирает payload после загрузки (без гонки с маунтом).
  // Тема — из payload (#305): применяется ДО рендера карточки; окно вообще
  // невидимо до popup_ready, так что кадров в чужой теме не бывает.
  useEffect(() => {
    void invoke<PopupData | null>('popup_get_data').then((payload) => {
      if (payload?.theme === 'dark') document.documentElement.dataset.theme = 'dark';
      else delete document.documentElement.dataset.theme;
      setData(payload);
      setReplying(false);
      setText('');
    });
  }, []);

  // Фактическая высота карточки → оболочке (#406). Меряем контент (заголовок
  // + превью + поле ответа) и прибавляем padding/border самой карточки:
  // rem-утилиты масштабируются --ui-scale, поэтому «высота на глаз» врёт.
  // ResizeObserver ловит открытие/закрытие поля ответа и загрузку шрифта;
  // окно растёт ДО фокуса в поле, стек поднимает верхние попапы кумулятивно.
  useLayoutEffect(() => {
    if (!data) return;
    const card = cardRef.current;
    const content = contentRef.current;
    if (!card || !content) return;
    let disposed = false;
    const report = () => {
      if (disposed) return;
      const styles = getComputedStyle(card);
      const chrome = [
        styles.paddingTop,
        styles.paddingBottom,
        styles.borderTopWidth,
        styles.borderBottomWidth,
      ].reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0);
      // +1 — страховка от субпиксельного округления DPI: содержимое не
      // должно упираться в границу окна.
      const height = Math.ceil(content.getBoundingClientRect().height + chrome) + 1;
      if (Math.abs(height - reportedHeight.current) < 1) return;
      reportedHeight.current = height;
      void invoke('popup_set_height', { height })
        .catch(() => {
          /* не разрешили/окно закрылось — показ всё равно страхует fallback */
        })
        .then(() => {
          if (!disposed) setMeasured(true);
        });
    };
    report();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(report);
    observer?.observe(content);
    void document.fonts?.ready.then(report, () => {});
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [data]);

  // Готовность к показу (#305): данные+тема применены и высота окна
  // применена (иначе первый кадр обрезан), двойной rAF = первый кадр
  // отрисован — просим оболочку показать окно (страховка таймаута там).
  useEffect(() => {
    if (!data || !measured) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void invoke('popup_ready');
      }),
    );
  }, [data, measured]);

  // Rust-арбитр угасания сигналит напрямую (мост портала сюда не инъектируется).
  useEffect(() => {
    (window as { __popupFade?: (phase: string) => void }).__popupFade = (phase: string) => {
      setFade(phase === 'start' ? 'fading' : 'reset');
      if (phase !== 'start') {
        setTimeout(() => setFade('idle'), 350);
      }
    };
  }, []);

  function close() {
    void invoke('popup_close');
  }

  function startReply() {
    setReplying(true);
    // Активация окна идёт через Rust (`set_focusable(true)` + `set_focus`):
    // фокус поля ставим ПОСЛЕ ответа команды, иначе гонка с асинхронной
    // активацией — поле остаётся без клавиатуры (#709).
    void invoke('popup_set_expanded', { expanded: true })
      .catch(() => {})
      .then(() => {
        // Фокус после кадра: поле уже смонтировано. Карточка — overflow:clip,
        // поэтому scroll-into-view не может увести содержимое за границы.
        requestAnimationFrame(() => requestAnimationFrame(() => inputRef.current?.focus()));
      });
  }

  function send() {
    if (!data || text.trim().length === 0 || sending) return;
    setSending(true);
    void invoke('popup_submit_reply', {
      payload: { id: data.id, conversationId: data.conversationId, text: text.trim() },
    })
      .then(close)
      .catch(() => setSending(false));
  }

  function openTarget() {
    if (!data) return;
    // Письмо (#618): своя цель — карточка письма (событие open-letter);
    // трэд (попап об ответе в трэде, #300) — портал раскроет окно трэда.
    if (data.letterId) {
      void invoke('popup_open', { letterId: data.letterId }).then(close);
      return;
    }
    void invoke('popup_open', {
      conversationId: data.conversationId,
      threadRootId: data.threadRootId ?? null,
    }).then(close);
  }

  if (!data) {
    return <div className="h-screen w-screen bg-transparent" />;
  }

  const fadeClass =
    fade === 'fading'
      ? 'opacity-0 transition-opacity duration-[3000ms] ease-linear'
      : fade === 'reset'
        ? 'opacity-100 transition-opacity duration-300'
        : 'opacity-100';

  return (
    <div
      ref={cardRef}
      className={`group bg-card text-card-foreground relative flex h-screen w-screen flex-col overflow-clip rounded-xl border p-2 font-sans ${fadeClass}`}
      onMouseEnter={() => {
        setHovered(true);
        void invoke('popup_set_hover', { hover: true });
      }}
      onMouseLeave={() => {
        setHovered(false);
        void invoke('popup_set_hover', { hover: false });
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        if (replying) {
          setReplying(false);
          void invoke('popup_set_expanded', { expanded: false });
        } else {
          close();
        }
      }}
    >
      {/* Контент — естественная высота: оболочка узнаёт её и растит окно. */}
      <div ref={contentRef} className="flex shrink-0 flex-col">
        {data.download ? (
          <DownloadCard download={data.download} paused={hovered} />
        ) : (
          /* Клик по карточке — открыть источник (как клик по уведомлению в Telegram):
           *  беседу (#300) или карточку письма (#618). */
          <button
            type="button"
            onClick={openTarget}
            className="flex min-w-0 shrink-0 cursor-pointer items-start gap-2.5 text-left"
            title={t.popupOpen}
          >
            <Avatar url={data.avatarUrl} name={data.title} />
            <span className="min-w-0 flex-1">
              {/* Отступ под крестик — только у строки заголовка: превью ниже
               *  крестика и может использовать всю ширину (короткая фраза
               *  не уезжает на вторую строку из-за лишнего запаса). */}
              <span className="flex items-center gap-1.5 pr-6">
                <span className="truncate text-[13px] leading-4 font-semibold">{data.title}</span>
                {data.urgent ? (
                  <span className="bg-warning-soft text-warning rounded px-1 py-px text-[10px] leading-3 font-medium">
                    {t.urgentLabel}
                  </span>
                ) : null}
              </span>
              {/* line-clamp-2 ставит display:-webkit-box; block/display-утилиты его
               *  перебивают — многоточие пропадает (docs/gotchas/frontend.md, #652). */}
              <span
                className={`mt-1 line-clamp-2 max-h-8 overflow-hidden text-[12px] leading-4 [overflow-wrap:anywhere] ${
                  data.previewAttachment ? 'text-info' : 'text-muted-foreground'
                }`}
              >
                {data.preview}
              </span>
            </span>
          </button>
        )}

        {replying ? (
          // Поле мягкое как композер: БЕЗ бордера и БЕЗ рамки фокуса (фон
          // muted), одна строка; гексагон — ВНУТРИ поля по центру высоты.
          // flex-строка убирает baseline-щель inline-block (лишние px высоты).
          <div className="relative mt-2 flex shrink-0 items-center">
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t.popupReplyPlaceholder}
              maxLength={4000}
              className="bg-muted w-full rounded-lg border-0 py-2 pl-3 pr-10 text-[13px] leading-4 caret-foreground outline-none"
            />
            <button
              type="button"
              onClick={send}
              disabled={text.trim().length === 0 || sending}
              aria-label={t.popupSend}
              title={t.popupSend}
              className="text-info hover:text-info/80 absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center disabled:opacity-40"
            >
              <SendHexIcon className="size-5" />
            </button>
          </div>
        ) : null}
      </div>

      {/* Крестик: SVG-глиф заполняет кнопку (канон Telegram notifyClose —
       *  иконка ≈ 70% зоны), ховер ровно по видимой кнопке (фидбек 08.10).
       *  Абсолютный — ВНЕ потока контента, доступен в любом режиме. */}
      <button
        type="button"
        aria-label={ui.common.close}
        onClick={close}
        className="text-muted-foreground hover:text-foreground hover:bg-accent absolute top-1 right-1 z-10 flex size-5 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.6}
          strokeLinecap="round"
          className="size-3.5"
          aria-hidden
        >
          <path d="M5 5l14 14M19 5 5 19" />
        </svg>
      </button>

      {/* «Ответить» — маленькая, поверх контента, только на hover (Telegram). */}
      {!replying && data.canReply ? (
        <button
          type="button"
          onClick={startReply}
          className="text-muted-foreground hover:text-foreground absolute right-2 bottom-2 cursor-pointer rounded-md bg-card px-2 py-0.5 text-[12px] font-medium opacity-0 transition-opacity group-hover:opacity-100"
        >
          {t.popupReply}
        </button>
      ) : null}
    </div>
  );
}

/** Аватар автора крупный (Telegram): кружок почти во всю высоту карточки —
 *  он задаёт её высоту (референс владельца 03.11), имя и превью прижаты к
 *  верху рядом с ним. Удалённая картинка/сбой — заглушка с инициалом. */
function Avatar({ url, name }: { url?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || 'N';
  if (!url || failed) {
    return (
      <div className="bg-muted text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold">
        {initial}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      onError={() => setFailed(true)}
      className="size-14 shrink-0 rounded-full object-cover"
    />
  );
}
