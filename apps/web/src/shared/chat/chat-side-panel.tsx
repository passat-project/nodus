import { ArrowLeft, PanelRight, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConversationListItem, VaultItemType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { cn } from '@nodus/ui/lib/utils';

import { ChatSearchPanel } from './chat-search-panel.js';
import { isNotesConversation } from './conversations.js';
import { ConversationMembersPanel } from './conversation-members.js';
import { ChatProfilePane } from './chat-profile-pane.js';
import { useFavorites } from './favorites-api.js';
import { NotesSourcesPane, type NotesSourceId } from './notes-sources-pane.js';
import { VaultWindow } from './vault-window.js';

import { useAuthStore } from '../auth-store.js';
import { useFrameReady } from '../ui/use-frame-ready.js';
import { uiPx } from '../ui/ui-scale.js';

/** Ширина вталкивающей панели беседы: контейнер уменьшает чат на неё. */
export const CHAT_PANEL_W = uiPx(300);

/** Минимум ЛЕНТЫ при открытой панели (вердикт владельца: 280 — «слишком
 *  малая») и соответствующий минимум всей колонки чата. */
export const MIN_FEED_WITH_PANEL = uiPx(360);
export const MIN_COLUMN_WITH_PANEL = MIN_FEED_WITH_PANEL + CHAT_PANEL_W;

/**
 * Состояние панели беседы: обёртка монтируется СРАЗУ и ПОСТОЯННО (w-0), а
 * контент — лениво на первом открытии и далее остаётся (приём обёртки
 * панели «О задаче»: первый тоггл не платит маунтом панели и данных в
 * кадрах анимации — рывка нет, баг-вердикт владельца 15.09.2026).
 */
export function useChatSidePanel() {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, toggle, close };
}

/**
 * ЗАКОН (вердикт владельца 2026-09-11): где чат — там правая панель с
 * файлами и ссылками беседы. Канон — панель «О задаче»: ВТАЛКИВАЮЩАЯ
 * колонка справа (не оверлей — композер и лента доступны), тоггл — кнопка
 * СПРАВА ВВЕРХУ в шапке беседы (её рисует контейнер: страница мессенджера
 * или колонка чата карточки). Панель двигает область чата; когда чат уже на
 * минимальной ширине — выталкивает левую часть (auto-колонки grid).
 * В карточке задачи её роль играет панель «О задаче» (те же секции +
 * история и избранное).
 *
 * Панель — ОДНА на беседу (хостится контейнером), НЕ на зону: окно треда
 * рядом с лентой (#42) не умножает правых панелей (research OpenClaw:
 * несколько rail'ов съедают ширину ленты и множат границы ресайза).
 *
 * #211 (вердикт владельца 04.10): панель — ЧИСТОЕ хранилище беседы,
 * БЕЗ избранного; просмотр избранного централизован в чате «Избранное» —
 * там панель показывает ИСТОЧНИКИ звёзд (NotesSourcesPane, реф Telegram
 * Saved). РЕВИЗИЯ владельца 05.10 (модель Telegram): панель — профиль
 * чата (большой аватар, «Звук»/«Копировать ссылку») + кликабельные
 * категории-счётчики БЕЗ превью; клик открывает окно категории
 * (VaultWindow) поверх всей панели — только «назад», без крестика.
 * Скоуп-тоггл «Вся беседа/Этот тред» снят (в Telegram/Битриксе его нет).
 *
 * ГЕОМЕТРИЯ (вердикт владельца 15.09.2026, рефы Битрикс24): панель —
 * ПОЛНОВЫСОТНАЯ колонка-сиблинг всего контента хоста: занимает ВЕРХНИЙ БАР
 * тоже. Её верхняя строка (высотой в бар хоста, `headerClass`) = название
 * панели («О чате»/«О канале»/«О проекте») СЛЕВА + крестик У САМОГО КРАЯ
 * справа; никаких внутренних перегородок в баре. Кнопка-тоггл остаётся в
 * баре беседы и уезжает ВЛЕВО при раскрытии (бар хоста сужается панелью).
 *
 * ПЕРВОЕ открытие — ПЛАВНОЕ (баг-вердикт владельца 15.09.2026): панель
 * монтируется в момент первого открытия, свежему элементу transition идти
 * неоткуда — появлялась рывком. Монтируем в покое (w-0) и раскрываем классом
 * ПОСЛЕ двух кадров (`useFrameReady`) — transition стартует с первого кадра.
 */
export function ChatSidePanel({
  conversationId,
  conversation,
  open,
  onClose,
  title,
  headerClass = 'h-14',
  widthPx,
  view = 'files',
  onMembersClose,
  onSearchBack,
  onAddMembers,
  onOpenNotesSource,
}: {
  conversationId: string;
  /** Беседа для вида «Участники» (#186) и профиля (ревизия 05.10): роли,
   *  права матрицы, аватар/подпись/звук. */
  conversation?: ConversationListItem;
  open: boolean;
  onClose: () => void;
  title: string;
  /** Высота верхней строки панели = высота верхнего бара хоста (линия
   *  border-b продолжаются друг в друга). */
  headerClass?: string;
  /** Ширина колонки в CSS px (карточки с областями вкладок): по умолчанию
   *  rem-класс 18.75rem масштабируется ui-scale, а solver карточки считает
   *  экранные px — без явной ширины панель вылезала бы за расчётную. */
  widthPx?: number;
  /** Вид колонки (#186 + поиск 04.10): файлы/ссылки («О чате»), участники —
   *  панель участников стоит РОВНО ПОВЕРХ тоггл-панели (та же колонка 1:1),
   *  поиск — лупа в шапке беседы раскрывает ту же панель с поисковой
   *  строкой и топ-выдачей (модель Битрикс24, вердикт владельца 04.10). */
  view?: 'files' | 'members' | 'search';
  /** Выход из вида участников: назад к файлам (если панель была открыта)
   *  или свернуть колонку — решает хост. */
  onMembersClose?: () => void;
  /** Выход из вида поиска «назад» — к панели вложений (колонка открыта). */
  onSearchBack?: () => void;
  /** Открыть окно добавления участников (кнопка «Добавить»). */
  onAddMembers?: () => void;
  /** Клик по источнику в панели чата «Избранное» (#211 Ф3) — хост открывает
   *  окно-фильтр поверх витрины. */
  onOpenNotesSource?: (source: NotesSourceId) => void;
}) {
  const meId = useAuthStore((s) => s.user?.id ?? null);
  // Чат «Избранное»: панель — источники звёзд (Ф3), НЕ хранилище файлов.
  const isNotes = Boolean(conversation && isNotesConversation(conversation, meId));
  // Окно категории витрины (ревизия 05.10): поверх всей панели, «назад».
  const [vaultType, setVaultType] = useState<VaultItemType | null>(null);
  // Карточки звёзд для категорий «Избранного» (режим окна): тот же кэш,
  // что у витрины чата (ключ useFavorites() — без фильтров).
  const favorites = useFavorites();
  const favoriteCards = useMemo(
    () => (favorites.data?.pages ?? []).flatMap((page) => page.items),
    [favorites.data],
  );
  // Плавное ПЕРВОЕ открытие: монтируемся в покое (w-0), класс раскрытия —
  // после двух кадров (useFrameReady), transition идёт с первого кадра.
  const ready = useFrameReady();
  // Контент панели монтируется ВМЕСТЕ с панелью — ещё в свёрнутом виде: НИ
  // один выезд колонки не платит маунтом в кадрах анимации (ленивый маунт
  // первого открытия давал «гармошку» выезда, 04.10 р.6).
  const columnOpen = open || view !== 'files';
  // Окно категории персонально беседе и виду: смена беседы (карточка
  // подменяет без ремаунта), свёртка колонки и чужие виды сбрасывают.
  useEffect(() => {
    setVaultType(null);
  }, [conversationId, open, view]);

  return (
    <div
      aria-hidden={!columnOpen}
      inert={!columnOpen}
      className={cn(
        'h-full shrink-0 overflow-hidden',
        // В карточках с solver'ом (widthPx) ширина уже зарезервирована
        // расчётом: анимировать её нельзя — область успевает пересчитаться
        // под конечную ширину, и вкладки «сжимаются и возвращаются».
        !widthPx && 'transition-[width] duration-200 ease-out',
        !widthPx && (columnOpen && ready ? 'w-[18.75rem]' : 'w-0'),
      )}
      style={widthPx ? { width: columnOpen ? widthPx : 0 } : undefined}
    >
      <aside
        className={cn(
          'relative flex h-full flex-col border-l border-border bg-card',
          widthPx ? 'w-full' : 'w-[18.75rem]',
        )}
        style={widthPx ? { width: widthPx } : undefined}
      >
        {/* Верхняя строка панели — НА УРОВНЕ бара хоста: название слева,
            крестик у самого правого края (реф Битрикс24, вердикт владельца
            15.09.2026); border-b продолжает линию бара хоста. Вид участников
            (#186): у края СЛЕВА стрелка «назад», если под ним открыта панель
            «О чате» (возврат к файлам), иначе крестик (свернуть колонку).
            Вид поиска (04.10, раунд 4): строки НЕТ — шапку рисует сам поиск
            (крестик/«назад» + строка-пилюля, реф Битрикс24). */}
        {view !== 'search' ? (
          <div
            className={cn(
              'flex shrink-0 items-center gap-2 border-b border-border px-3',
              headerClass,
            )}
          >
            {view === 'members' ? (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 hover:bg-accent"
                onClick={onMembersClose ?? onClose}
                aria-label={open ? ui.chat.membersBack : ui.common.close}
                title={open ? ui.chat.membersBack : ui.common.close}
              >
                {open ? <ArrowLeft /> : <X />}
              </Button>
            ) : null}
            <NodeLabel
              label={
                view === 'members' ? ui.chat.membersPanelTitle : isNotes ? ui.chat.notes : title
              }
            />
            {view !== 'members' ? (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto shrink-0 hover:bg-accent"
                onClick={onClose}
                aria-label={ui.common.close}
              >
                <X />
              </Button>
            ) : null}
          </div>
        ) : null}
        {view === 'members' && conversation ? (
          <ConversationMembersPanel
            conversation={conversation}
            onAddMembers={onAddMembers ?? (() => {})}
          />
        ) : (
          <>
            {/* Панель вложений/источников: смонтирована ПОСТОЯННО после
                первого открытия (без ремаунтов при смене видов — плавность
                анимаций колонки); в режиме поиска скрыта CSS — поиск стоит
                ПОВЕРХ неё. */}
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-y-auto p-4',
                view === 'search' && 'hidden',
              )}
            >
              {isNotes ? (
                <NotesSourcesPane
                  onOpenSource={onOpenNotesSource ?? (() => {})}
                  onOpenVaultType={setVaultType}
                />
              ) : (
                /* Закрепов в панели НЕТ (вердикт владельца 24.09, #91):
                    обзор закрепов — пин-бар ленты; панель — профиль беседы
                    (ревизия 05.10): аватар, «Звук», категории-счётчики. */
                <ChatProfilePane
                  conversationId={conversationId}
                  conversation={conversation}
                  onOpenVaultType={setVaultType}
                />
              )}
            </div>
            {/* Поиск — ПОВЕРХ панели вложений (кнопка «назад», канон вида
                участников) или standalone (крестик). Смонтирован ВСЕГДА:
                первый выезд панели — чистая смена классов, тот же ритм
                анимации, что у вложений/участников (ремаунт в кадре
                анимации давал «инерцию с запаздыванием», 04.10 р.5). */}
            <ChatSearchPanel
              conversationId={conversationId}
              isFavorites={isNotes}
              active={view === 'search'}
              overFiles={open}
              onBack={onSearchBack ?? onClose}
              onClose={onClose}
              className={view !== 'search' ? 'hidden' : undefined}
            />
          </>
        )}
        {/* Окно категории витрины (ревизия 05.10): absolute на КОРНЕ aside —
            перекрывает и верхний бар панели; смонтировано всегда (закон
            выдвижных поверхностей, w-0 в покое). «Избранное» — карточный
            режим (категории считают ЗВЁЗДЫ, не беседу «Избранное»). */}
        <VaultWindow
          conversationId={conversationId}
          type={vaultType}
          cards={isNotes ? favoriteCards : undefined}
          onClose={() => setVaultType(null)}
        />
      </aside>
    </div>
  );
}

/** Кнопка тоггла панели беседы — для шапки беседы СПРАВА ВВЕРХУ (канон
 *  кнопки «О задаче» в полосе карточки задачи). При открытой панели уезжает
 *  влево: панель занимает её место в баре (вердикт владельца 15.09.2026). */
export function ChatPanelToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={ui.chat.panelTitle}
      title={ui.chat.panelTitle}
      className={cn(
        'shrink-0 rounded-lg p-2 transition-colors hover:bg-accent',
        open ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <PanelRight className="size-4" strokeWidth={1.75} />
    </button>
  );
}
