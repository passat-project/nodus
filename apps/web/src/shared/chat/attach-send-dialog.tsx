import { Paperclip } from 'lucide-react';
import { useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { Textarea } from '@nodus/ui/components/textarea';

import { plural } from '../lib/format.js';
import { attachPreviewImages, hasAttachPreview } from './attach-preview.js';
import { AttachSendRow } from './attach-send-row.js';
import { EMPTY_DRAFT, useChatDrafts } from './chat-drafts.js';
import { addFiles, replaceFile } from './composer-files.js';
import { MentionFieldOverlay } from './composer-mention-overlay.js';
import { MentionAutocompletePanel } from './composer-mention-autocomplete.js';
import { useAttachSendDialog } from './dialog-stores.js';
import { ImageLightbox } from './image-lightbox.js';
import { ComposerBanner } from './composer-banner.js';
import { FileDropOverlay, useFileDrop } from './feed-dropzone.js';
import { isImeComposing, isNewlineShortcut, isSendShortcut } from './send-keys.js';
import { useAttachSend } from './use-attach-send.js';
import { useCaptionMentions } from './use-caption-mentions.js';

/**
 * Окно отправки вложений (#144, референсы Telegram/Bitrix, вердикт владельца
 * 29.09.2026): любое прикрепление открывает окно вместо трея у строки ввода.
 * Строки — превью/иконка, имя, размер, drag-сортировка за точки, снятие;
 * «Добавить» — ещё файлы; подпись — ОТДЕЛЬНОЕ поле окна (не дублируется
 * онлайн в композер; отмена возвращает текст черновиком — семантика
 * Telegram). Футер БЕЗ разделителей (канон nodus-ui §37): Добавить / Отмена
 * / Отправить. Отправка — через реестр submit-функций хостов
 * (submit-registry): оптимистичность, reply и threadRootId не дублируются.
 * Ошибка отправки окно НЕ закрывает — файлы и текст живы, повтор возможен
 * (#123). Супер-курсор: при открытии фокус на подписи, drag-ручка фокус не
 * забирает (каретка живёт и во время сортировки), после закрытия — возврат
 * в композер (dialog-hosts).
 *
 * @упоминания подписи (#239, вердикт владельца — «во всех полях ввода без
 * исключений»): автокомплит + чипы как в композере — подпись хранит WIRE-текст
 * (токены), окно держит ЛОКАЛЬНЫЙ реестр чипов (видимый текст без разметки);
 * открытие разбирает wire → display+реестр, отправка пересобирает wire,
 * отмена возвращает черновику через restoreFromWire (чипы не теряются).
 *
 * Цитата ответа над списком файлов (#288, паритет Telegram): ответ, активный
 * в композере, виден и в окне — плашка ComposerBanner (без прыжка: за
 * модалом лента не видна); крестик снимает ответ в черновике (гаснет и в
 * композере). На полёте отправки цитата живёт снапшотом flightReply — как
 * строки flightItems (#248).
 */
// Подпись с @упоминаниями — use-caption-mentions.ts, отправка/отмена —
// use-attach-send.ts, превью — attach-preview.ts; здесь — разметка окна и
// супер-курсор.

export function AttachSendDialogHost() {
  const scope = useAttachSendDialog((s) => s.scope);
  const close = useAttachSendDialog((s) => s.close);
  const caption = useAttachSendDialog((s) => s.caption);
  const setCaption = useAttachSendDialog((s) => s.setCaption);
  const draft = useChatDrafts((s) => (scope ? (s.drafts[scope] ?? EMPTY_DRAFT) : EMPTY_DRAFT));
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // «Заменить вложение» (#188): строка, на которую подменяет следующий
  // выбранный файл (скрытый инпут окна один на все источники).
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  // Инлайн-правка имени строки (#188, вердикт владельца 04.10): супер-курсор
  // временно погашен — каретка в поле имени; после применения/отката —
  // возврат в подпись. Ref — чтобы фокус-хендлеры без ре-рендера видели.
  const [renameActive, setRenameActive] = useState(false);
  const renameActiveRef = useRef(false);
  renameActiveRef.current = renameActive;
  // Синхронный флаг старта правки имени (приёмка 13.11): setState коммитится
  // не мгновенно, а rAF-возврат каретки успевал кадром раньше и выдёргивал
  // фокус из поля имени — blur применял старое имя. ref ставим ДО setState.
  const draggingRef = useRef<string | null>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const captionMentions = useCaptionMentions({ scope, caption, setCaption, captionRef });
  const { mentions, mentionList, editToken } = captionMentions;
  const { items, shownReply, editMode, sending, sendHint, limit, canSend, cancelAll, send } =
    useAttachSend({
      scope,
      draft,
      caption,
      close,
      mentionListRef: captionMentions.mentionListRef,
    });
  // Дроп файлов прямо в открытое окно (#716, канон Telegram/Discord): тот же
  // приём, что у ленты (guard внутренних драгов #242), но обработчики — на
  // контейнере диалога: обёртка стала бы лишним grid-элементом окна.
  const drop = useFileDrop((files) => {
    if (scope) addFiles(scope, files);
  });

  function handleRenameMode(active: boolean) {
    // ref СНАЧАЛА: все rAF/blur-страховки супер-курсора читают его, а не
    // ещё не закоммиченный state (гонка «правка имени применяется сама»).
    renameActiveRef.current = active;
    setRenameActive(active);
    if (!active) refocusCaption();
  }

  // Картинки окна — локальные objectURL новых загрузок ИЛИ серверные
  // превью строк правимого сообщения (#188); лайтбокс смотрит их же.
  const previewImages = attachPreviewImages(items);
  const previewIndex = (localId: string) => previewImages.findIndex((p) => p.id === localId);

  if (!scope) return null;

  /** Клавиатура подписи (#239): упоминания (чипы/автокомплит) — хук
   *  подписи; модифицированный Enter — перенос строки (#777), чистый —
   *  отправка (канон композера). IME-композиция клавиши не отбирает. */
  function handleCaptionKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isImeComposing(event)) return;
    if (isNewlineShortcut(event)) {
      event.preventDefault();
      captionMentions.insertNewline();
      return;
    }
    if (captionMentions.handleMentionKeyDown(event)) return;
    if (isSendShortcut(event)) {
      event.preventDefault();
      void send();
    }
  }

  // Живой реордер БЕЗ dnd-kit (вердикт 29.09.2026): PointerSensor dnd-kit
  // подавляет каретку/выделение в полях на всё время drag — супер-курсор
  // подписи умирал. Наша механика: строки меняются местами в DOM прямо во
  // время drag по elementsFromPoint, ничего не уезжает за пределы списка.
  function handleDragMove(x: number, y: number) {
    const dragging = draggingRef.current;
    if (!scope || !dragging) return;
    const under = (document.elementsFromPoint(x, y) as HTMLElement[])
      .map((el) => el.closest('[data-attach-row]'))
      .find(Boolean) as HTMLElement | undefined;
    const overId = under?.dataset.attachRow;
    if (!overId || overId === dragging) return;
    const itemsNow = (useChatDrafts.getState().drafts[scope] ?? EMPTY_DRAFT).attachments;
    const from = itemsNow.findIndex((i) => i.localId === dragging);
    const to = itemsNow.findIndex((i) => i.localId === overId);
    if (from >= 0 && to >= 0) useChatDrafts.getState().reorderAttachments(scope, from, to);
  }

  /** Фокус подписи с кареткой В КОНЦЕ текста (#241): при открытии окна текст
   *  композера уже переехал в подпись — «начало строки» заставляло вручную
   *  переносить курсор, чтобы продолжить писать. Единая точка для всех
   *  возвратов фокуса (открытие, кража клика, drag-сортировка, лайтбокс). */
  function focusCaption() {
    const el = captionRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }

  /** Страховка супер-курсора: каретка вернётся в подпись, если фокус ушёл
   *  в никуда (body) — кадром позже (drag-ручка фокус не забирает). */
  function refocusCaption() {
    requestAnimationFrame(() => {
      if (!useAttachSendDialog.getState().scope) return;
      if (renameActiveRef.current) return;
      // Фокус уже в ЛЮБОМ поле ввода (поле имени, подпись) — не отбираем:
      // второй рубеж против гонки, когда флаг ещё не был выставлен.
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest('textarea, input, [contenteditable="true"]')) return;
      focusCaption();
    });
  }

  /** Супер-курсор окна (#144, вердикт 29.09.2026): любой клик вне полей ввода
   *  возвращает мигающую каретку в подпись — как «вечный курсор» чата.
   *  Исключение — правка имени строки (#188, вердикт владельца 04.10):
   *  курсор временно погашен, клики фокус не воруют. */
  function stealCaret(event: React.MouseEvent) {
    if (renameActiveRef.current) return;
    const target = event.target as HTMLElement;
    if (target.closest('textarea, input, [contenteditable="true"]')) return;
    focusCaption();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Пока открыт лайтбокс превью, внешние клики модала (pointerdown
        // мимо контента) не отменяют окно (валидатор #144).
        if (!open && lightbox !== null) return;
        if (!open) cancelAll();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        /* Дроп файла в ЛЮБОЕ место окна (#716) — обработчики drop-зоны на
           самом контенте диалога, оверлей — его абсолютным ребёнком. */
        {...drop.handlers}
        /* Крестик окна НЕ нужен (вердикт 29.09.2026): отмена — кнопкой
           «Отмена» в футере; крестики остаются ТОЛЬКО на строках вложений. */
        showCloseButton={false}
        /* Клик снаружи НЕ закрывает окно (#148, владелец 29.09: «опасный
           баг — теряются вложения и текст»): случайный мимо-клик не может
           уничтожить работу. Отмена — только намеренная: «Отмена» или Esc;
           референсы Telegram/Битрикс тоже не закрывают окно по заднику. */
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          // Esc в поле имени гасит только правку имени — окно живо (#188):
          // Radix ловит keydown на document (capture) раньше поля, поэтому
          // подавляем ЗАКРЫТИЕ здесь, откат делает само поле.
          if (renameActiveRef.current) event.preventDefault();
          // Esc при открытой панели автокомплита гасит ПАНЕЛЬ, не окно (#239):
          // mentionAutocompleteKeydown съедает клавишу в поле, но Radix
          // слышит её раньше — глушим закрытие и здесь.
          if (mentions.open) event.preventDefault();
        }}
        onClick={stealCaret}
        onOpenAutoFocus={(event) => {
          // Супер-курсор окна: набор текста начинается сразу в подписи —
          // каретка В КОНЦЕ уже написанного текста (#241).
          event.preventDefault();
          focusCaption();
        }}
        onBlur={() => {
          // Супер-курсор НЕ ПРОПАДАЕТ: каретка живёт в подписи всё время,
          // пока окно открыто. Ушла в никуда (body) или на НЕ-поле внутри
          // окна (кнопка строки/ручка drag) — возвращаем (тайминг — как в
          // refocusCaption, позже 50-мс окна очистки dnd-kit). Внешний слой
          // (лайтбокс превью) фокусом владеет — не трогаем. Правка имени
          // строки — каретка в поле имени, не воруем (#188).
          if (renameActiveRef.current) return;
          const active = document.activeElement as HTMLElement | null;
          if (active?.closest('textarea, input, [contenteditable="true"]')) return;
          if (active && active !== document.body && !active.closest('[data-slot="dialog-content"]'))
            return;
          refocusCaption();
        }}
      >
        <FileDropOverlay active={drop.active} />
        <DialogHeader>
          <DialogTitle>
            {editMode
              ? ui.chat.editTitle
              : `${ui.chat.attachSelected} ${items.length} ${plural(items.length, [ui.chat.fileOne, ui.chat.fileFew, ui.chat.fileMany])}`}
          </DialogTitle>
        </DialogHeader>
        {/* Цитата ответа над списком файлов (#288, паритет Telegram): тот же
            примитив, что у композера; в окне она индикатор — тело не прыгает
            (лента за модалом не видна), крестик снимает ответ и в окне, и в
            композере (один черновик). В полёте отправки не действует —
            payload уже собран (канон «Отмена»). */}
        {shownReply ? (
          <ComposerBanner
            draft={{ ...EMPTY_DRAFT, reply: shownReply }}
            className="rounded-[10px]"
            onCancel={() => {
              if (!sending) useChatDrafts.getState().cancelReply(scope);
            }}
          />
        ) : null}
        {/* Фиксированные границы зоны списка: габарит окна не прыгает
            (канон nodus-ui §39). */}
        <ul className="flex min-h-14 max-h-[45vh] flex-col gap-1 overflow-x-hidden overflow-y-auto pr-1">
          {items.map((item) => (
            <AttachSendRow
              key={item.localId}
              scope={scope}
              item={item}
              dragging={draggingId === item.localId}
              /* Меню строки — в ОБОИХ режимах (#146): «Переименовать файл»
                 нужен и в окне отправки (имя уходит в attachmentRenames
                 отправки), «Заменить вложение» работает на любом составе. */
              actions
              onRenameMode={handleRenameMode}
              onReplace={() => {
                // «Заменить вложение» (#188): выбор файла подменяет цель
                // скрытого инпута окна (обычное «Добавить» не трогаем).
                setReplaceTarget(item.localId);
                fileRef.current?.click();
              }}
              onDragStart={() => {
                draggingRef.current = item.localId;
                setDraggingId(item.localId);
              }}
              onDragMove={handleDragMove}
              onDragEnd={() => {
                draggingRef.current = null;
                setDraggingId(null);
              }}
              onPreview={
                hasAttachPreview(item) ? () => setLightbox(previewIndex(item.localId)) : undefined
              }
            />
          ))}
        </ul>
        {/* @упоминания подписи (#239): та же машинерия, что в композере —
            в поле ВИДИМЫЙ текст (имена без разметки), зеркальный оверлей
            подчёркивает чипы, панель автокомплита всплывает над полем.
            Метрика зеркала = поле (px-1.5 py-1.5, канон композера #228).
            min-w-0 (#277, канон обёртки композера): без него grid-элемент
            сетки окна получает авто-минимум = min-content поля, а поле с
            field-sizing-content в min-content = вся набранная строка —
            длинная подпись растягивала окно и футер за границы. */}
        <span className="relative block min-w-0">
          {mentions.open ? (
            <MentionAutocompletePanel
              candidates={mentions.autocomplete.candidates}
              active={mentions.autocomplete.active}
              onHover={mentions.autocomplete.setActive}
              onPick={mentions.pick}
              anchorRef={captionRef}
            />
          ) : null}
          <MentionFieldOverlay
            text={caption}
            mentions={mentionList}
            textareaRef={captionRef}
            editToken={editToken}
            // У поля подписи ВИДИМАЯ рамка (border-input, 1px) — зеркало
            // повторяет её прозрачной: иначе content-box зеркала на 1px
            // выше/левее, и выделенный текст «двоится»/размывается (#409).
            className="border border-transparent"
            onRename={captionMentions.renameMention}
            onRemove={captionMentions.removeMention}
            onEditClose={() => {
              captionMentions.setEditToken(null);
              const el = captionRef.current;
              if (el) mentions.syncCaret(el);
            }}
          />
          <Textarea
            ref={captionRef}
            value={caption}
            onChange={(event) => {
              captionMentions.handleCaptionChange(event.target.value);
              mentions.syncCaret(event.target);
            }}
            onPaste={(event) => {
              // Ctrl+V в окне добавляет вложение (в правке — НЕ новое
              // сообщение, #188; в отправке — тот же канон Telegram).
              const files = Array.from(event.clipboardData.files);
              if (files.length === 0) return;
              event.preventDefault();
              addFiles(scope, files);
            }}
            onKeyUp={(event) => mentions.syncCaret(event.currentTarget)}
            // Клик по чипу — поповер правки label (#228, как композер).
            onClick={(event) => captionMentions.handleCaptionClick(event.currentTarget)}
            onKeyDown={handleCaptionKeyDown}
            placeholder={ui.chat.attachCaption}
            rows={2}
            /* Канон чатов: спокойная рамка поля ЕСТЬ, но фокус НЕ подсвечивает
               зону (ни белого бордера, ни кольца) — супер-курсор без подсветки
               (вердикты 29.09.2026: и подсветка, и голое поле без рамки — нет).
               Текст прозрачен — видно зеркало оверлея с чипами (#239);
               паддинги = метрике зеркала (px-1.5 py-1.5, канон композера). */
            /* max-h-[45vh] — канон композера 15.09 (#277): field-sizing-рост
               поля по вертикали ограничен высотой зоны (габарит окна не прыгает,
               §39), дальше скролл внутри поля (оверлей синхронит scrollTop).
               Скроллбар скрыт: его 3px сужали контентную ширину поля, а
               зеркало (overflow-hidden) ширину не меняло — переносы
               расходились, каретка уезжала на строку (#409). */
            className="min-h-16 max-h-[45vh] resize-none border-input bg-transparent px-1.5 py-1.5 text-transparent caret-foreground shadow-none [scrollbar-width:none] focus-visible:border-input focus-visible:ring-0 dark:bg-transparent [&::-webkit-scrollbar]:hidden"
          />
        </span>
        {limit.counter ? (
          <p className={limit.over ? 'text-xs text-danger' : 'text-xs text-muted-foreground'}>
            {limit.counter}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="sm:mr-auto"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip />
            {ui.common.add}
          </Button>
          <Button type="button" variant="ghost" onClick={cancelAll}>
            {ui.common.cancel}
          </Button>
          <Button type="button" onClick={() => void send()} disabled={!canSend} title={sendHint}>
            {editMode ? ui.common.save : ui.chat.attachSend}
          </Button>
        </DialogFooter>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (scope && event.target.files) {
              // Замена (#188): один файл на место строки-цели; иначе —
              // обычное добавление («Добавить», дроп, Ctrl+V).
              const files = Array.from(event.target.files);
              if (replaceTarget !== null) {
                const [file] = files;
                if (file) replaceFile(scope, replaceTarget, file);
                setReplaceTarget(null);
              } else {
                addFiles(scope, files);
              }
            }
            event.target.value = '';
          }}
        />
      </DialogContent>
      {/* Просмотр картинки поверх окна (вердикт 29.09.2026): закрыл лайтбокс —
          вернулся В окно отправки продолжать (каретка — в подписи). */}
      {lightbox !== null ? (
        <ImageLightbox
          images={previewImages}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => {
            setLightbox(null);
            focusCaption();
          }}
        />
      ) : null}
    </Dialog>
  );
}
