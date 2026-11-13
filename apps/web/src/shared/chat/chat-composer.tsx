import { Paperclip, Smile } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';

import { useComposerInputActions, useGrown } from './composer-input-utils.js';
import { useSelectionPhase } from './selection-phase.js';
import { EMPTY_DRAFT, useChatDrafts } from './chat-drafts.js';
import { MediaPickerButton } from './media-picker.js';
import { ComposerUrgentButton } from './composer-urgent.js';
import { useComposerSendError } from './composer-errors.js';
import { ComposerBanner } from './composer-banner.js';
import { ComposerClipMenu } from './composer-clip-menu.js';
import { ComposerSendButton } from './composer-send-button.js';
import { ComposerStatusLine } from './composer-status-line.js';
import { ComposerTextField } from './composer-text-field.js';
import { flushDraftSync } from './draft-sync.js';
import { ForwardBanner } from './forward-banner.js';
import { useForwardPending } from './forward-pending.js';
import { useJumpStore } from './jump-store.js';
import { chatKeys } from './chat-keys.js';
import { SelectionToolbar } from './selection-island.js';
import { StickerSuggestPanel, useStickerSuggest } from './composer-sticker-suggest-panel.js';
import { useComposerMentions } from './composer-mention-autocomplete.js';
import { composerKeyDown } from './composer-keydown.js';
import type { MentionHit } from './composer-mention-overlay.js';
import { registerScopeConversation } from './scope-conversations.js';
import type { ComposerSubmit } from './composer-submit.js';
import type { ComposerSelection } from './selection-island.js';
import { useComposerFocus } from './use-composer-focus.js';
import { useComposerSubmit, useRequestScrollEnd } from './use-composer-submit.js';

/**
 * Композер сообщений (единый для чатов, каналов, тредов и обсуждений; файл
 * >300 строк — сборка ВСЕХ режимов композера по вердиктам 14–24.09, детали
 * вынесены: клип-меню `composer-clip-menu.tsx`, тулбар селекта
 * `selection-island.tsx`, бары `composer-banner.tsx`/`forward-banner.tsx`,
 * сабмит `use-composer-submit.ts`, «вечный курсор» `use-composer-focus.ts`,
 * поле с упоминаниями `composer-text-field.tsx`, строка статуса
 * `composer-status-line.tsx`, кнопка отправки/мика `composer-send-button.tsx`).
 * «Островок» ввода (rounded-2xl bg-card, тень-ступень) парит над тоном
 * chat-zone БЕЗ внешнего контура и разделителя (вердикт 24.09: модель
 * Bitrix24/Telegram — владелец: «бары режимов не должны растягивать кнопку
 * отправки»). Строки островка: бар ответа/правки, бар пересылки, трей
 * вложений, строка ввода (скрепка слева, поле, смайл и мик/отправка справа).
 * Отправка — ghost-кнопка с чистым гексагоном `SendHexIcon` БЕЗ заливки, в
 * семье смайл/мик (тон темнее), видна ТОЛЬКО при тексте/вложениях/баре
 * пересылки (пусто — микрофон-заглушка, модель Telegram: ввод голоса и
 * текста взаимоисключащи), в правке — галка; габарит один с миком (size-8 —
 * переключение не двигает строку). Enter — отправить, Shift/Ctrl+Enter —
 * перенос (вердикт 14.09.2026). Контур поля при фокусе НЕ подсвечивается.
 *
 * Линия A (#87): состояние — в drafts-сторе per focusId (черновик переживает
 * смену беседы + индикатор в списке); вставка файлов Ctrl+V; бары ответа-
 * цитаты и правки (взаимоисключающие, Esc-каскад — канон Discord: сначала
 * режимы композера, слайдер не закрываем); ↑ на пустом поле — правка
 * последнего своего (официальный шорткат Telegram). Пересылка: бар получателя
 * (forward-pending) — комментарий полем, отправка шлёт блок + комментарий
 * (модель Bitrix24). Селект ленты: островок сужается в узкий батч-островок и
 * расширяется обратно СИММЕТРИЧНО от центра (фазы normal/sel/exit: mx-auto
 * держится весь exit, тулбар живёт внутри до конца расширения — без пустой
 * фазы и развёртки «слева направо», баг-вердикт раунда 4).
 */
export function ChatComposer({
  placeholder,
  focusId,
  conversationId,
  typingThreadRootId = null,
  onSubmit,
  attachmentsEnabled: attachmentsEnabledProp = false,
  /** Стикеры (#143): хосты на чужом API (обсуждение задачи — tasks) их не
   *  поддерживают; по умолчанию включены вместе с чат-конвейером. */
  stickersEnabled = true,
  onEditLast,
  selection = null,
  disabledPlaceholder = null,
  /** Молния «Важное» (#177): false — кнопки нет (Заметки — чат с собой). */
  urgentEnabled = true,
  className,
}: {
  placeholder: string;
  /** Владелец «вечного курсора» (composer-focus) И ключ черновика (scope). */
  focusId: string;
  /** Беседа — для прыжка по клику на бар ответа. */
  conversationId?: string;
  /** Печать В ТРЕДЕ (раунд 3): индикатор — шапка окна треда, не список бесед. */
  typingThreadRootId?: string | null;
  onSubmit: (submit: ComposerSubmit) => void;
  /** Полный режим (мессенджер): скрепка-меню, вставка файлов, ↑-правка. */
  attachmentsEnabled?: boolean;
  /** Стикеры вкладки пикера (#143): false — вкладка недоступна (task-хост). */
  stickersEnabled?: boolean;
  /** ↑ на пустом поле: хост открывает правку последнего своего сообщения. */
  onEditLast?: () => void;
  /** Активный мультивыбор ленты: островок сужается до батч-команд. */
  selection?: ComposerSelection | null;
  /** Гейт прав (каналы без post): строка-заглушка ВНУТРИ островка (#130
   *  изоморфизм + #132 р.8): выход из селекта морфится в заглушку той же
   *  анимацией (288px→100%), а не мгновенной подменой компонента. */
  disabledPlaceholder?: string | null;
  /** Молния «Важное» (#177): false — кнопки нет (Заметки). */
  urgentEnabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const islandRef = useRef<HTMLSpanElement>(null);

  // Хост-разрешение на вложения (панельные исключения передают false);
  // файловое хранилище (#57) сняло гейт живого режима — скрепка работает
  // и на моках, и вживую.
  const attachmentsEnabled = attachmentsEnabledProp;

  const draft = useChatDrafts((s) => s.drafts[focusId] ?? EMPTY_DRAFT);
  const setText = useChatDrafts((s) => s.setText);
  const pending = useForwardPending((s) => s.pendings[focusId] ?? null);
  const sel = selection && selection.count > 0 ? selection : null;
  const text = draft.text;
  const grown = useGrown(inputRef);

  // @упоминания (#176): каретка + запрос — useComposerMentions; клик по чипу
  // поля — поповер правки (composer-mention-overlay).
  const [editToken, setEditToken] = useState<MentionHit | null>(null);
  const mentions = useComposerMentions({
    conversationId,
    text,
    inputRef,
    insertMention: (atStart, atEnd, id, label) =>
      useChatDrafts.getState().insertMention(focusId, atStart, atEnd, id, label),
  });
  // Реестр чипов черновика (#228): в поле ВИДИМЫЙ текст, каретка нативная.
  const draftMentions = draft.mentions ?? [];

  // Карта scope→беседа для окна вложений (#239): автокомплит подписи окна
  // показывает состав участников, scope треда id беседы не несёт.
  useEffect(() => {
    registerScopeConversation(focusId, conversationId);
  }, [focusId, conversationId]);

  // Морфология островка (селект) — хук selection-phase.ts (I5, #177).
  const { selPhase, toolbarSel } = useSelectionPhase(sel);

  // Стикеры недоступны в режиме селекта/пересылки и без права поста (#143).
  const stickersDisabled =
    !stickersEnabled || selPhase !== 'normal' || disabledPlaceholder !== null || pending !== null;

  // Наружное зеркало open пикера (#294): пока поповер смайла открыт, плашка
  // стикеров-подсказок скрыта (его портал z-70 перекрыл бы её).
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);

  const requestScrollEnd = useRequestScrollEnd(focusId);

  // Ввод-действия (эмодзи/стикер/paste) — хук composer-input-utils.ts
  // (раньше плашки подсказок: её выбор уходит через pickSticker).
  const { insertEmoji, insertNewline, pickSticker, onPaste } = useComposerInputActions({
    focusId,
    conversationId,
    typingThreadRootId,
    text,
    inputRef,
    attachmentsEnabled,
    setText,
    onSubmit,
    requestScrollEnd,
    syncCaret: mentions.syncCaret,
  });

  // Плашка стикеров-подсказок при вводе соло-эмодзи (#294): детект по
  // тексту+каретке; скрыта, когда стикеры недоступны, идёт правка
  // (стикер в правке — бессмыслица) или открыт медиа-пикер.
  const suggest = useStickerSuggest({
    text,
    caret: mentions.caret,
    suppressed: stickersDisabled || draft.edit !== null || mediaPickerOpen,
    focusId,
    setText,
    submitSticker: pickSticker,
  });

  // «Вечный курсор» (реф-колбэк поля, каретка в конец черновика) —
  // use-composer-focus.ts.
  const { registerInput, onInputFocus } = useComposerFocus({
    focusId,
    inputRef,
    syncCaret: mentions.syncCaret,
  });

  // Черновик — ТОЛЬКО на уходе из беседы (вердикт владельца 25.09:
  // «онлайн-трансляция набранного текста не нужна»): во время набора сервер
  // молчит (метки/подъёма в списке во время набора нет); PUT — при
  // переключении беседы/размонтировании и при скрытии вкладки/закрытии
  // страницы (слушатели ухода ставятся при инициализации draft-sync). Режим
  // правки черновик не пишет вовсе. Флуш ПРЕДЫДУЩЕЙ беседы: React вызывает
  // ПРЕДЫДУЩИЙ cleanup и при смене focusId (композер переиспользуется при
  // переключении бесед внутри мессенджера), и при размонтировании — оба
  // случая = «ушёл из беседы». Инвалидация списка — ТОЛЬКО после завершения
  // PUT: одновременный refetch обгонял PUT и приходил без метки (дефект
  // приёмки 25.09 «метка появляется только при выходе из модуля»).
  const queryClient = useQueryClient();
  useEffect(() => {
    return () => {
      void flushDraftSync(focusId).then((sent) => {
        if (sent) void queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
      });
    };
  }, [focusId, queryClient]);

  // Инлайн-ошибка 409 политики важных (#177): стоит рядом с молнией до
  // следующей попытки отправки (гасится в onMutate мутации).
  const sendError = useComposerSendError(focusId);
  const { limit, sendVisible, submit } = useComposerSubmit({
    focusId,
    draft,
    draftMentions,
    pending,
    onSubmit,
    requestScrollEnd,
  });

  function onSubmitForm(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  // Клавиатура поля — composer-keydown.ts (I5-сплит): атомарные клавиши
  // чипа, автокомплит, отправка, Esc-каскад режимов, ↑-правка последнего.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) =>
    composerKeyDown(event, {
      focusId,
      text,
      mentions: draftMentions,
      removeMention: (index) => useChatDrafts.getState().removeMention(focusId, index),
      autocomplete: {
        open: mentions.open,
        count: mentions.autocomplete.candidates.length,
        active: mentions.autocomplete.active,
        setActive: mentions.autocomplete.setActive,
        pick: mentions.pick,
        dismiss: mentions.dismiss,
      },
      stickerSuggest: {
        open: suggest.open,
        count: suggest.matches.length,
        active: suggest.active,
        setActive: suggest.setActive,
        pick: suggest.pick,
        dismiss: suggest.dismiss,
      },
      submit,
      insertNewline,
      pendingForward: pending !== null,
      hasReply: draft.reply !== null,
      hasEdit: draft.edit !== null,
      onEditLast,
    });

  const align = grown ? 'self-end' : 'self-center';

  return (
    <form
      onSubmit={onSubmitForm} // pt-1.5 (7.5px @1.25): зазор метка «Просмотрено»→остров = 1.5× зазора
      // пузырь→метка (вердикт владельца раунда 4). Меньше нельзя: этот паддинг —
      // ЕДИНСТВЕННАЯ полоса под низом ленты (метка = нижняя граница прокрутки,
      // gotchas «Фронтенд»); больше — метка «висит» по вердикту владельца.
      className={cn('shrink-0 px-3 pt-1.5 pb-2', className)}
    >
      {/* Островок ввода: ступень тона + тень вместо контура (вердикт 24.09) —
          бары режимов и трей вложений растут ВНУТРИ, строка ввода остаётся
          одной строкой фиксированной высоты. */}
      <span
        ref={islandRef}
        className={cn(
          // relative — якорь панели стикеров-подсказок (#294): панель во всю
          // ширину островка, выезжает из-под его верхней кромки.
          'relative rounded-2xl bg-card shadow-sm transition-all duration-200',
          selPhase === 'sel'
            ? 'mx-auto flex w-72 items-center gap-0.5 px-2 py-1.5'
            : selPhase === 'exit'
              ? 'mx-auto flex w-full items-center gap-0.5 px-2 py-1.5'
              : 'flex w-full px-2 py-1.5',
        )}
      >
        {/* Панель стикеров-подсказок (#294): перекрывает ленту над островком,
            ничего в ней не двигая; с плашкой баннеров/строки ввода не
            пересекается — anchored к островку целиком. */}
        {suggest.open ? (
          <StickerSuggestPanel
            matches={suggest.matches}
            active={suggest.active}
            onPick={suggest.pick}
          />
        ) : null}
        {selPhase !== 'normal' && toolbarSel ? (
          // Р.9–10: тулбар ПРОЯВЛЯЕТСЯ при сужении (composer-reveal) и
          // РАСТВОРЯЕТСЯ на старте расширения (composer-hide в фазе exit,
          // frozen) — счётчик не висит слева у расширяющейся области.
          <span
            className={cn(
              'flex w-full items-center gap-0.5',
              selPhase === 'exit' ? 'composer-hide' : 'composer-reveal',
            )}
          >
            <SelectionToolbar
              sel={toolbarSel}
              frozen={selPhase === 'exit'}
              conversationId={conversationId}
            />
          </span>
        ) : disabledPlaceholder !== null ? (
          // Гейт прав (р.8): заглушка живёт ВНУТРИ островка — морф селекта
          // (288px→100%) доезжает до неё той же анимацией; геометрия строки
          // изоморфна вводу (#130): min-h-8 px-1.5 py-1.5 text-sm.
          <span className="composer-reveal min-h-8 w-full px-1.5 py-1.5 text-sm text-muted-foreground">
            {disabledPlaceholder}
          </span>
        ) : (
          // Р.9: разворот полного контента после морфа — контент монтируется
          // прозрачным и проявляется (composer-reveal), а не вспыхивает
          // скачком на финальной ширине островка.
          <span className="composer-reveal flex w-full flex-col gap-1">
            {draft.reply || draft.edit ? (
              <ComposerBanner
                draft={draft}
                onCancel={() => {
                  const store = useChatDrafts.getState();
                  if (draft.edit) store.cancelEdit(focusId);
                  else store.cancelReply(focusId);
                }}
                onJump={
                  draft.reply && conversationId
                    ? () =>
                        useJumpStore
                          .getState()
                          .request(
                            conversationId,
                            draft.reply?.messageId ?? '',
                            draft.reply?.inThread,
                          )
                    : undefined
                }
              />
            ) : null}
            {pending ? (
              <ForwardBanner
                pending={pending}
                onCancel={() => useForwardPending.getState().clear(focusId)}
              />
            ) : null}
            {/* Трея вложений НЕТ (#144): прикреплённые файлы живёт в окне
                отправки (attach-send-dialog), строка ввода — только текст. */}
            {/* Превалидация лимита текста (раунд 3): счётчик у черты 4000,
                при превышении — понятное сообщение; отправка заблокирована,
                текст остаётся в поле/черновике (серверный 422 не наступает).
                Рядом — инлайн-ошибка 409 политики важных (#177). */}
            <ComposerStatusLine limit={limit} sendError={sendError} />
            <span className="flex items-end gap-0.5">
              {attachmentsEnabled ? (
                <ComposerClipMenu
                  draftKey={focusId}
                  islandRef={islandRef}
                  align={align}
                  disabled={pending !== null}
                />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn('shrink-0 text-muted-foreground', align)}
                  // Хост запретил вложения: скрепка на месте, но выключена.
                  aria-label={ui.chat.attachFile}
                  title={ui.chat.attachFile}
                  disabled
                >
                  <Paperclip strokeWidth={1.75} />
                </Button>
              )}
              {/* Фокус на входе в чат — ЧЕРЕЗ registerComposer (реф-колбэк
                  textarea): el.focus({preventScroll:true}). БЕЗ autoFocus-
                  атрибута (#132 р.11): НАТИВНЫЙ автофокус скроллит ВСЕХ
                  предков без preventScroll — при открытии окна трэда композер
                  монтируется за правым краем overflow-hidden рамки, браузер
                  сдвигал её контент на ~7px влево и обратно (jitter-лог
                  владельца: все дети рамки -7px, ширины на месте) — «весь
                  контент карточки дёргается». rows=1 + field-sizing: рост до
                  45vh, дальше скролл внутри поля (вердикт 15.09.2026).
                  @упоминания (#176/#228): в поле ВИДИМЫЙ текст (имена
                  без разметки), зеркальный оверлей композера рисует его
                  метрически 1:1 с подчёркиванием чипов. Каретка НАТИВНАЯ
                  (caret-foreground) — стоит там, где ввод; клики по
                  подчёркнутому имени открывают поповер правки. */}
              <ComposerTextField
                focusId={focusId}
                conversationId={conversationId}
                typingThreadRootId={typingThreadRootId}
                text={text}
                draftMentions={draftMentions}
                mentions={mentions}
                inputRef={inputRef}
                registerInput={registerInput}
                editToken={editToken}
                onEditToken={setEditToken}
                onInputFocus={onInputFocus}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                placeholder={placeholder}
              />
              {/* Молния «Важное» (#177, ревизия 05.10 — тоггл с бейджем
                  зарядов): слева от смайликов; в правке, пересылке, селекте
                  и без права поста — выключена; в Заметках — скрыта. */}
              {urgentEnabled && disabledPlaceholder === null ? (
                <ComposerUrgentButton
                  draftKey={focusId}
                  align={align}
                  disabled={draft.edit !== null || pending !== null || selPhase !== 'normal'}
                />
              ) : null}
              {/* Медиа-пикер (#130 → #143): вкладки «Эмодзи | Стикеры»,
                  вставка эмодзи в каретку, стикер — мгновенная отправка;
                  попап не крадёт «вечный курсор». Стикеры недоступны в
                  режиме селекта/пересылки и без права поста. */}
              <MediaPickerButton
                onPickEmoji={insertEmoji}
                onPickSticker={pickSticker}
                closeOnStickerPick /* #288: стикер ушёл — панель закрыта, каретка в поле */
                finalFocusRef={inputRef}
                stickersDisabled={stickersDisabled}
                onOpenChange={setMediaPickerOpen}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn('shrink-0 text-muted-foreground', align)}
                  aria-label={ui.chat.emoji}
                  title={ui.chat.emoji}
                >
                  <Smile strokeWidth={1.75} />
                </Button>
              </MediaPickerButton>
              <ComposerSendButton
                sendVisible={sendVisible}
                editing={draft.edit !== null}
                align={align}
              />
            </span>
          </span>
        )}
      </span>
    </form>
  );
}
