import { useEffect, useState } from 'react';
import { ui } from '@nodus/contracts';

import { ProjectIdentityIcon } from '../../shared/ui/project-identity-icon.js';
import { useCounterpartyCard } from '../../shared/counterparties/queries.js';
import { LetterCard } from '../../features/correspondence/components/card/letter-card.js';
import { LetterTitle } from '../../features/correspondence/components/card/letter-title.js';
import { CounterpartyCard } from '../../features/crm/components/counterparty-card.js';
import { MessengerBody, type ChatTab } from '../../features/chat/components/messenger-body.js';
import { MessengerTabs } from '../../features/chat/components/messenger-tabs.js';
import { useUsersList } from '../../features/directory/api/directory-api.js';
import { EmployeeCard } from '../../features/directory/components/employee-card.js';
import { subscribeMessengerThread, takeMessengerThread } from '../../shared/chat/messenger-nav.js';
import { useProjectDetail } from '../../features/projects/api/projects-api.js';
import { ProjectCard } from '../../features/projects/components/project-card.js';
import { ProjectTitle } from '../../features/projects/components/project-title.js';
import { TaskCard } from '../../features/tasks/components/task-card.js';
import { TaskTitle } from '../../features/tasks/components/task-title.js';
import type { CardRef } from './card-stack.js';
import { SliderPanel, type SourceRect } from './slider-panel.js';
import { useShellStore } from './shell-store.js';
import { useCardStack, useCloseCard } from './use-card-stack.js';

/**
 * Хост стека карточек сущностей (ADR-0009): читает стек из `?cards=` и
 * рендерит слайдеры ПО ПОРЯДКУ стека (DOM-порядок = z-порядок: верхняя
 * карточка последняя). Нижние карточки остаются смонтированными — закрытие
 * верхней возвращает к прежней с целым состоянием (скролл, вкладки, черновики).
 *
 * Все карточки — EAGER-импорты (не lazy-чанки): карточка — центральный экран
 * продукта и открывается из любого раздела, поэтому загрузка их кода платится
 * один раз на старте приложения, а открытие мгновенно у всех сущностей
 * (вердикт владельца: «как карточки задач — без прогрузки и фризов»).
 */

interface EntryProps {
  id: string;
  source: SourceRect | undefined;
  onClose: () => void;
  /** Карточка спит под верхними (content-visibility, issue #63): рендеринг
   *  её поддерева пропускается, состояние сохраняется. */
  dormant: boolean;
}

function TaskEntry({ id, source, onClose, dormant }: EntryProps) {
  return (
    <SliderPanel
      title={<TaskTitle taskId={id} />}
      onClose={onClose}
      sourceRect={source}
      fadeContent={false}
      dormant={dormant}
    >
      <TaskCard taskId={id} />
    </SliderPanel>
  );
}

function ProjectEntry({ id, source, onClose, dormant }: EntryProps) {
  const { data: project } = useProjectDetail(id);
  return (
    <SliderPanel
      title={
        <span className="flex min-w-0 items-center gap-2">
          {project ? <ProjectIdentityIcon color={project.color} /> : null}
          <ProjectTitle projectId={id} />
        </span>
      }
      onClose={onClose}
      sourceRect={source}
      fadeContent={false}
      dormant={dormant}
    >
      <ProjectCard projectId={id} />
    </SliderPanel>
  );
}

function LetterEntry({ id, source, onClose, dormant }: EntryProps) {
  return (
    <SliderPanel
      title={<LetterTitle letterId={id} />}
      onClose={onClose}
      sourceRect={source}
      fadeContent={false}
      dormant={dormant}
    >
      <LetterCard letterId={id} />
    </SliderPanel>
  );
}

function EmployeeEntry({ id, source, onClose, dormant }: EntryProps) {
  const { data } = useUsersList();
  const user = data?.items.find((u) => u.id === id);
  return (
    <SliderPanel
      title={user?.displayName ?? ui.employees.title}
      onClose={onClose}
      sourceRect={source}
      fadeContent={false}
      dormant={dormant}
    >
      <EmployeeCard userId={id} />
    </SliderPanel>
  );
}

function CounterpartyEntry({ id, source, onClose, dormant }: EntryProps) {
  const { data: card } = useCounterpartyCard(id);
  return (
    <SliderPanel
      title={card?.shortName ?? ui.counterparties.counterparty}
      onClose={onClose}
      sourceRect={source}
      dormant={dormant}
    >
      <CounterpartyCard counterpartyId={id} />
    </SliderPanel>
  );
}

/** Мессенджер — ПОЛНОЭКРАННАЯ карточка стека (ADR-0009 + план
 *  `docs/mvp/archive/messenger-fullscreen-plan.md`, вердикт владельца 15.09.2026,
 *  модель Битрикс24): клик по беседе в служебной полосе открывает
 *  полноценный мессенджер (вкладки Чаты/Чаты задач/Настройка, список бесед,
 *  весь функционал — единое тело `MessengerBody` со страницей /chat) ПОВЕРХ
 *  текущей карточки; полоса под карточкой НАКРЫТА ею (inset-2 периметра —
 *  дубль списка невидим и недоступен; скрывать полосу шеллом НЕЛЬЗЯ: карточки
 *  под верхней поехали бы на 40px во время раскрытия — баг-вердикт владельца
 *  15.09.2026), закрытие (X/Esc) возвращает к предыдущей сущности с её
 *  состоянием. id — беседа, выбранная при открытии; подмена верхней
 *  карточки (клик по другой беседе полосы, переход по пересланному —
 *  `replaceTopMessengerCard`, вердикт 25.09) меняет id БЕЗ ремаунта панели —
 *  синхронизация эффектом; пристоенный тред подмены потребляется тут же
 *  (messenger-nav). Вкладка и тред — локальное состояние (чужие маршруту
 *  search-параметры не пишем). */
function MessengerEntry({ id, source, onClose, dormant }: EntryProps) {
  const [conversationId, setConversationId] = useState(id);
  const [tab, setTab] = useState<ChatTab>('chats');
  // Пристоенный тред (messenger-nav): потребляется на МАУНТЕ карточки,
  // при подмене верхней карточки и ПО ПОДПИСКЕ — клик по уведомлению о
  // трэде при уже открытой карточке той же беседы (openCard там no-op, #300).
  const [threadRootId, setThreadRootId] = useState<string | null>(() => takeMessengerThread(id));
  useEffect(
    () =>
      subscribeMessengerThread(() => {
        const staged = takeMessengerThread(conversationId);
        if (staged !== null) setThreadRootId(staged);
      }),
    [conversationId],
  );
  // Подмена беседы (replaceTop): сброс треда — он принадлежал прежней беседе
  // (рендер-тайм сброс по смене id, канон React, аудит #45); пристоенный тред
  // подмены (переход по пересланному в тред канала) — наоборот, открывается.
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) {
    setPrevId(id);
    setConversationId(id);
    setThreadRootId(takeMessengerThread(id));
  }
  return (
    <SliderPanel
      cardTopbar
      fullscreen
      headerContent={<MessengerTabs tab={tab} onChange={setTab} />}
      onClose={onClose}
      sourceRect={source}
      fadeContent={false}
      dormant={dormant}
    >
      <MessengerBody
        tab={tab}
        conversationId={conversationId}
        onSelectConversation={setConversationId}
        // Внутренняя навигация мессенджера (вердикт 25.09): переход к беседе-
        // источнику пересылки ЗАМЕНЯЕТ содержимое слайдера (без вложенных
        // слайдеров и без невидимых действий под ним).
        onOpenConversation={(targetId, targetThread) => {
          setConversationId(targetId);
          setThreadRootId(targetThread);
        }}
        threadRootId={threadRootId}
        onOpenThread={setThreadRootId}
        onCloseThread={() => setThreadRootId(null)}
      />
    </SliderPanel>
  );
}

/** Один слайдер стека: rect источника потребляется на маунте (FLIP-раскрытие
 *  из строки/карточки, по которой кликнули); восстановленные из URL (F5,
 *  прямая ссылка) раскрываются сдержанным scale-fade. */
function CardStackEntry({
  cardRef,
  dormant,
  onClose,
}: {
  cardRef: CardRef;
  dormant: boolean;
  onClose: () => void;
}) {
  const [source] = useState(() => useShellStore.getState().lastSource ?? undefined);
  useEffect(() => {
    useShellStore.getState().setLastSource(null);
  }, []);

  switch (cardRef.kind) {
    case 'task':
      return <TaskEntry id={cardRef.id} source={source} onClose={onClose} dormant={dormant} />;
    case 'project':
      return <ProjectEntry id={cardRef.id} source={source} onClose={onClose} dormant={dormant} />;
    case 'letter':
      return <LetterEntry id={cardRef.id} source={source} onClose={onClose} dormant={dormant} />;
    case 'employee':
      return <EmployeeEntry id={cardRef.id} source={source} onClose={onClose} dormant={dormant} />;
    case 'counterparty':
      return (
        <CounterpartyEntry id={cardRef.id} source={source} onClose={onClose} dormant={dormant} />
      );
    case 'messenger':
      return <MessengerEntry id={cardRef.id} source={source} onClose={onClose} dormant={dormant} />;
  }
}

export function CardStackHost() {
  const stack = useCardStack();
  const closeCard = useCloseCard();
  // DORMANCY нижних карточек (issue #63): у стека уровней/смещений нет — всё
  // кроме верхней полностью накрыто, но его тяжёлое поддерево (чаты, таблицы)
  // продолжало перекладываться на каждый кадр width-перехода полосы.
  // content-visibility:hidden на хосте отключает рендеринг накрытых
  // карточек; пробуждение — на один шаг глубже (`cardClosing`): верхняя
  // начала закрываться → нижняя отрисовывается в окне гашения контента
  // (CONTENT_FADE_MS) ДО схлопывания верхней — «провала» на фон нет.
  const cardClosing = useShellStore((s) => s.cardClosing);
  const revealFrom = stack.length - 1 - (cardClosing ? 1 : 0);
  return stack.map((cardRef, index) => (
    // index+kind в ключе (без id): одна сущность может встречаться в стеке
    // дважды (цепочка задача → подзадача); замена верхней (режим «Навигация»
    // ветки, useReplaceTopCard) подменяет id БЕЗ ремаунта панели — карточка
    // стоит на месте, меняется только содержимое.
    <CardStackEntry
      key={`${index}:${cardRef.kind}`}
      cardRef={cardRef}
      dormant={index < revealFrom}
      onClose={closeCard}
    />
  ));
}
