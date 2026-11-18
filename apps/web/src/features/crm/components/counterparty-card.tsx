import { Archive, Building2, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';

import { useCloseCard } from '../../../app/shell/use-card-stack.js';
import { isDomainMocked } from '../../../shared/api/api-mock-config.js';
import { useClientProjects } from '../../../shared/api/counterparty-relations.js';
import { useSplitWidth } from '../../../shared/ui/use-split-width.js';
import { useCounterpartyCard } from '../../../shared/counterparties/queries.js';
import { useCanManageCounterparties } from '../../../shared/counterparties/use-crm-permissions.js';
import { useDeleteCounterparty, useSetCounterpartyArchived } from '../api/counterparty-edit.js';
import { CounterpartyContactsTab } from './counterparty-contacts-tab.js';
import { CounterpartyFormDialog } from './counterparty-form-dialog.js';
import { CounterpartyLettersTab, CounterpartyProjectsTab } from './counterparty-related.js';
import { CounterpartyRequisites } from './counterparty-requisites.js';

function CardSkeleton() {
  return (
    <div className="content-fade flex h-full flex-col gap-4 overflow-y-auto p-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-32 w-full max-w-2xl" />
    </div>
  );
}

/** Состояние «не найден / нет доступа»: архив не отдаётся только при
 *  выключенном модуле или устаревшей ссылке — вечного скелетона нет (Д2). */
function CardNotFound() {
  return (
    <div className="content-fade flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <Building2 className="size-6 text-muted-foreground" strokeWidth={1.5} />
      <p className="text-sm font-medium text-foreground">{ui.counterparties.notFound}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{ui.counterparties.notFoundHint}</p>
    </div>
  );
}

/** Действия карточки — нижний бар h-16, кнопки СЛЕВА (анатомия карточки
 *  письма/задачи); право `crm.manage` (сервер — истина, I8). */
function CardBottomBar({
  counterpartyId,
  archived,
}: {
  counterpartyId: string;
  archived: boolean;
}) {
  const canManage = useCanManageCounterparties();
  const setArchived = useSetCounterpartyArchived();
  const remove = useDeleteCounterparty();
  const closeCard = useCloseCard();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { data: card } = useCounterpartyCard(counterpartyId);
  if (!canManage) {
    return archived ? (
      <span className="text-xs text-muted-foreground">{ui.counterparties.archivedHint}</span>
    ) : null;
  }

  return (
    <>
      {archived ? (
        <Button
          size="sm"
          variant="outline"
          disabled={setArchived.isPending}
          onClick={() => setArchived.mutate({ id: counterpartyId, archived: false })}
        >
          <RotateCcw data-icon="inline-start" />
          {ui.counterparties.restore}
        </Button>
      ) : (
        <>
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil data-icon="inline-start" />
            {ui.counterparties.edit}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setConfirmOpen(true)}
          >
            <Archive data-icon="inline-start" />
            {ui.counterparties.archive}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 data-icon="inline-start" />
            {ui.counterparties.delete}
          </Button>
        </>
      )}
      {archived ? (
        <span className="ml-2 min-w-0 truncate text-xs text-muted-foreground">
          {ui.counterparties.archivedHint}
        </span>
      ) : null}

      <CounterpartyFormDialog open={editOpen} onOpenChange={setEditOpen} target={card ?? null} />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{ui.counterparties.deleteConfirmTitle}</DialogTitle>
            <DialogDescription>{ui.counterparties.deleteConfirmText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              {ui.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(counterpartyId, {
                  onSuccess: () => {
                    setDeleteOpen(false);
                    closeCard();
                  },
                })
              }
            >
              {ui.counterparties.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{ui.counterparties.archiveConfirmTitle}</DialogTitle>
            <DialogDescription>{ui.counterparties.archiveConfirmText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {ui.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={setArchived.isPending}
              onClick={() =>
                setArchived.mutate(
                  { id: counterpartyId, archived: true },
                  { onSuccess: () => setConfirmOpen(false) },
                )
              }
            >
              {ui.counterparties.archive}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type CounterpartyTab = 'contacts' | 'letters' | 'projects';

/**
 * Карточка контрагента (стек, ADR-0009) — анатомия карточки письма/задачи
 * (вердикт владельца 25.10.2026): ЛЕВАЯ колонка — данные (шапка + реквизиты
 * реестром полей) и нижний бар h-16 с действиями СЛЕВА; ПРАВАЯ зона —
 * ВКЛАДКИ связей (эксперимент владельца 25.10.2026 перед вкладками карточки
 * письма): «Контакты» (сущность для создания — «Создать» в строке
 * инструментов), «Письма» и «Проекты» (обратные ссылки — только просмотр и
 * переход в карточку). Каждая вкладка — полноценный список с колонками на
 * shared-реестрах. Данных у справочника мало — правая зона забирает
 * основную ширину. Письма/проекты запрашиваются, только когда домен уже
 * отвечает (моки dev-контура) или счётчик связей не пуст — до #55/#52 в
 * живом контуре запроса к несуществующему API нет.
 * Состояния: загрузка, «не найден / нет доступа», архивная карточка
 * (read-only + «Вернуть из архива»).
 */
export function CounterpartyCard({ counterpartyId }: { counterpartyId: string }) {
  const { data: card, isLoading } = useCounterpartyCard(counterpartyId);
  const canManage = useCanManageCounterparties();
  const [tab, setTab] = useState<CounterpartyTab>('contacts');
  const projectsQuery = useClientProjects(counterpartyId, {
    enabled: card !== undefined && (isDomainMocked('projects') || card.projectsCount > 0),
  });
  // Перегородка «данные | вкладки»: дефолт 50/50, ширина помнится (закон
  // выдвижных поверхностей — разделитель всегда тянется, вердикт 25.10.2026).
  const dataRef = useRef<HTMLDivElement>(null);
  const split = useSplitWidth(dataRef, {
    storeKey: 'nodus-card-counterparty-split-v1',
    min: 360,
    minOther: 420,
  });

  if (isLoading) return <CardSkeleton />;
  if (!card) return <CardNotFound />;
  const archived = card.archivedAt !== null;
  const projects = projectsQuery.data?.items ?? [];

  const tabs: { id: CounterpartyTab; label: string; count: number }[] = [
    {
      id: 'contacts',
      label: ui.counterparties.tabContacts,
      count: card.contactPersons.filter((p) => p.archivedAt === null).length,
    },
    {
      id: 'letters',
      label: ui.counterparties.tabLetters,
      // Проекция сервера — точное число (список вкладки грузится страницами).
      count: card.lettersCount,
    },
    {
      id: 'projects',
      label: ui.counterparties.tabProjects,
      count: projectsQuery.data ? projects.length : card.projectsCount,
    },
  ];

  return (
    <div className="flex h-full min-w-0">
      <div
        ref={dataRef}
        style={split.style}
        className={cn(
          'relative flex h-full shrink-0 flex-col border-r border-border @container',
          !split.dragging && 'transition-[width] duration-200 ease-out',
        )}
      >
        <div className="content-fade min-h-0 flex-1 overflow-y-auto p-6">
          <div className="flex items-start gap-3">
            <span className="node-panel flex size-10 shrink-0 items-center justify-center">
              <Building2 className="size-4.5 text-muted-foreground" strokeWidth={1.5} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">{card.shortName}</h2>
                {archived ? (
                  <NodeChip tone="muted">{ui.counterparties.archivedBadge}</NodeChip>
                ) : null}
              </div>
              <div className="mt-0.5 text-sm text-muted-foreground">{card.fullName}</div>
            </div>
          </div>

          <CounterpartyRequisites card={card} />
        </div>

        {/* Нижний бар — только когда есть действия (или пояснение в
            архиве): пустая полоса у сотрудника без прав — мусор. */}
        {canManage || archived ? (
          <div className="flex h-16 shrink-0 items-center gap-2 border-t border-border px-5">
            <CardBottomBar counterpartyId={card.id} archived={archived} />
          </div>
        ) : null}

        {/* Ручка перегородки: оверлей ПОВЕРХ структурной границы (канон
            карточки задачи/сотрудника — та же ручка, память своя). */}
        <div
          onPointerDown={split.onDividerDown}
          role="separator"
          aria-orientation="vertical"
          aria-label={ui.common.resizePanel}
          title={ui.common.resizePanel}
          className="group absolute top-0 right-0 z-10 h-full w-3 translate-x-1/2 cursor-col-resize"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-port/60 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>

      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Бар вкладок h-10 — тот же, что у карточек проекта/сотрудника. */}
        <div
          role="tablist"
          className="content-fade flex h-10 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border px-4"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex h-10 shrink-0 items-center gap-2 rounded-none border-b-2 px-3 text-body-xs font-medium transition-colors',
                tab === t.id
                  ? 'border-port text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground/80',
              )}
            >
              {t.label}
              <span className="font-mono text-label-sm text-muted-foreground tabular-nums">
                {t.count}
              </span>
            </button>
          ))}
        </div>

        <div className="content-fade min-h-0 flex-1 overflow-hidden">
          {tab === 'contacts' ? (
            <CounterpartyContactsTab
              counterpartyId={card.id}
              contacts={card.contactPersons}
              readOnly={archived}
            />
          ) : null}
          {tab === 'letters' ? (
            <CounterpartyLettersTab
              counterpartyId={counterpartyId}
              enabled={isDomainMocked('letters') || card.lettersCount > 0}
            />
          ) : null}
          {tab === 'projects' ? (
            <CounterpartyProjectsTab
              counterpartyId={counterpartyId}
              enabled={card !== undefined && (isDomainMocked('projects') || card.projectsCount > 0)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
