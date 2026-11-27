import { useCallback, useMemo, type ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Permission, ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';

import { useCardStack } from '../../../../app/shell/use-card-stack.js';
import { useProcessTypes } from '../../api/automation-api.js';
import { usePrefetchRoutes } from '../../api/routes-prefetch.js';
import { useCanManageWorkflows } from '../../../../shared/api/use-can-manage-workflows.js';
import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../../shared/auth-store.js';
import { replaceProcessesSurface } from '../../../../shared/workflow/processes-surface-search.js';
import { useWorkflowDetail } from '../../../../shared/workflow/workflow-api.js';
import { useRouteDocStore } from '../../model/route-doc-store.js';
import { CardTabStripAppearContext } from '../../../../shared/ui/entity-card/card-tab-strip.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';
import { ProcessTypeCard } from './process-type-card.js';
import { resolveProcessesSurface, type ProcessesSearch } from './resolve-surface.js';
import { UnifiedTypeList } from './unified-type-list.js';
import { WithoutProjectPage } from './without-project-page.js';

/** Слот рабочей области типа проекта и карточки типа папки (features/projects,
 *  #857): их собирает уровень app общими хостами `automation-hosts` — окна
 *  создания и окно атрибута открываются и из карточек стека (I6). */
export interface ProjectWorkspaceSlot {
  typeId: string;
}
export interface FolderCardSlot {
  kindId: string;
}

/** Рабочая область занята, но пуста: загружается то, что в ней появится. */
const blankMain = <main className="flex min-w-0 flex-1 flex-col" aria-busy="true" />;

/** Заглушка рабочей области — строка по центру. */
function MainNotice({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-1 items-center justify-center">
        <Empty>
          <EmptyTitle>{children}</EmptyTitle>
        </Empty>
      </div>
    </main>
  );
}

/** Слот окна создания типа (тип проекта / тип папки — features/projects). */
export interface CreateDialogSlot {
  onClose: () => void;
  onCreated: (id: string) => void;
  baseId?: string;
}
export type RenderCreateDialog = (slot: CreateDialogSlot) => ReactNode;

export interface ProcessesScreenSlots {
  renderProjectWorkspace?: (slot: ProjectWorkspaceSlot) => ReactNode;
  renderFolderCard?: (slot: FolderCardSlot) => ReactNode;
  renderProjectTypeCreate?: RenderCreateDialog;
  renderProcessTypeCreate?: RenderCreateDialog;
  renderKindCreate?: RenderCreateDialog;
  /** Архив/возврат типа проекта и типа папки — мутации фичи projects (I6). */
  onArchiveProject: (id: string, archived: boolean) => void;
  onArchiveNodeKind: (id: string, archived: boolean) => void;
}

/**
 * Вкладка «Процессы» — единый вход настройки процессов (#857, единая
 * модель §5): слева колонка из четырёх групп (Проекты с «Без проекта»,
 * Задачи, Письма, Папки), справа — по выбору: редактор маршрута, рабочая
 * область типа проекта (слот фичи projects), страница «Без проекта».
 * Связанные сущности (тип задачи из типа проекта, тип папки из типа
 * проекта) больше не переводят раму «внутрь» — строка списка открывает
 * карточку в общем стеке, поэтому крошек «‹ назад» у рамы нет.
 *
 * Правило ОДНОГО редактора маршрута: стор `useRouteDocStore` глобальный,
 * второй смонтированный редактор затирал бы первый. Когда в стеке лежит
 * карточка типа процесса, её редактор — единственный: редактор рамы
 * приостанавливается (`suspended`), черновик рамы читается из localStorage
 * при возврате. URL-модель и приоритеты — `resolve-surface.ts`.
 */
export function ProcessesScreen(slots: ProcessesScreenSlots) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as ProcessesSearch;
  const { data: types, isLoading } = useProcessTypes('include');
  const canManage = useCanManageWorkflows();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canSetup = permissions.includes(Permission.PROJECT_SETUP_MANAGE);
  const projectTypesQuery = useProjectTypes(true);
  const kindsQuery = useNodeKinds();
  const projectTypes = useMemo(() => projectTypesQuery.data ?? [], [projectTypesQuery.data]);
  const kinds = useMemo(() => kindsQuery.data ?? [], [kindsQuery.data]);

  const surface = resolveProcessesSurface(search, {
    processTypes: types ?? [],
    projectTypes,
    kinds,
    canSetup,
  });

  const alive = useMemo(() => (types ?? []).filter((t) => !t.archivedAt), [types]);
  usePrefetchRoutes(alive);
  const selected =
    surface.surface === 'type' ? (alive.find((t) => t.id === surface.typeId) ?? null) : null;
  const workflowQuery = useWorkflowDetail(selected?.workflowId ?? null, { keepPrevious: true });
  const workflow = workflowQuery.data;
  // Маршрут нового типа ещё грузится — на руках прежний: рама до готовности
  // следующей держит СОГЛАСОВАННУЮ пару «тип + маршрут» прежнего выбора. Ни
  // пустоты с «Создайте первый процесс» (мерцало при каждом выборе — вердикт
  // владельца), ни чужого графа под новым типом: тип в раме — тот, чей маршрут
  // на руках. Первое открытие типа (прежнего нет) — рабочая область ждёт
  // маршрут (`renderMain`): рама появляется сразу с графом.
  const shown =
    workflow && workflow.id !== selected?.workflowId
      ? (alive.find((t) => t.workflowId === workflow.id) ?? null)
      : selected;

  // Списки колонки ещё грузятся — адрес не разрешить (умолчание пустых списков
  // «Создайте первый процесс»): рабочая область пуста, пока не пришли все три.
  // Иначе перед рамой на пару кадров вспыхивала заглушка, а карточка папки
  // приходила после рамы проекта (список папок грузится дольше).
  const listsLoading = isLoading || projectTypesQuery.isLoading || kindsQuery.isLoading;

  // Метка черновика — у строки ТОГО типа, чей маршрут сейчас в сторе редактора
  // (по `workflowId`), независимо от того, какой тип выбран в раме: с черновиком
  // в карточке стека рама может показывать другой тип.
  const editorDirty = useRouteDocStore((s) => s.dirty);
  const editorWorkflowId = useRouteDocStore((s) => s.workflowId);
  const dirtyTypeIds = useMemo(() => {
    if (!editorDirty) return new Set<string>();
    const drafted = alive.find((t) => t.workflowId === editorWorkflowId);
    return new Set(drafted ? [drafted.id] : []);
  }, [editorDirty, editorWorkflowId, alive]);

  // В стеке есть карточка типа процесса — её редактор единственный.
  const stack = useCardStack();
  const suspended = stack.some((card) => card.kind === 'process-type');

  // Выбор в колонке заменяет поверхность ЦЕЛИКОМ (все четыре ключа), иначе
  // тип папки — он в адресе главнее остальных — «заклинивал» колонку.
  const go = useCallback(
    (patch: Record<string, string | undefined>) =>
      void navigate({
        to: '/automation',
        search: (prev) => replaceProcessesSurface(prev, patch),
      }),
    [navigate],
  );

  // «⋯ → Настройки типа…» строки колонки открывает окно настроек хоста:
  // выбор рамы не меняется, рама никуда не переезжает.
  const openSettings = useTypeSettingsStore((s) => s.openSettings);

  return (
    <div className="flex h-full min-h-0">
      <UnifiedTypeList
        processTypes={types ?? []}
        projectTypes={projectTypes}
        kinds={kinds}
        canSetup={canSetup}
        canManage={canManage}
        isLoading={isLoading}
        dirtyIds={dirtyTypeIds}
        selectedProcessTypeId={surface.surface === 'type' ? surface.typeId : undefined}
        selectedProjectTypeId={surface.surface === 'project' ? surface.typeId : undefined}
        selectedKindId={surface.surface === 'folder' ? surface.kindId : undefined}
        noProjectSelected={surface.surface === 'no-project'}
        onSelectProcessType={(id) => {
          go({ type: id });
        }}
        onOpenProcessTypeSettings={(id) => {
          useRouteDocStore.getState().select(null);
          openSettings({ kind: 'process-type', id });
        }}
        onSelectProjectType={(id) => {
          go({ ptype: id });
        }}
        onOpenProjectSettings={(id) => openSettings({ kind: 'project-type', id })}
        onSelectNoProject={() => {
          go({ noproject: '1' });
        }}
        onSelectKind={(id) => {
          go({ ftype: id });
        }}
        onOpenKindSettings={(id) => openSettings({ kind: 'node-kind', id })}
        onArchiveProject={slots.onArchiveProject}
        onArchiveNodeKind={slots.onArchiveNodeKind}
        renderProjectTypeCreate={slots.renderProjectTypeCreate}
        renderKindCreate={slots.renderKindCreate}
      />

      {/* Рабочая область перемонтируется на каждом выборе колонки; анимация
          появления полосы вкладок читалась здесь как мерцание — она остаётся
          только у карточек стека (раскрытие). */}
      <CardTabStripAppearContext value={false}>{renderMain()}</CardTabStripAppearContext>
    </div>
  );

  function renderMain(): ReactNode {
    if (listsLoading) return blankMain;
    if (surface.surface === 'folder') {
      if (!slots.renderFolderCard) return null;
      return (
        <main className="flex min-w-0 flex-1 flex-col">
          {slots.renderFolderCard({ kindId: surface.kindId })}
        </main>
      );
    }
    if (surface.surface === 'no-project') {
      return (
        <main className="flex min-w-0 flex-1 flex-col">
          <WithoutProjectPage canManage={canManage} />
        </main>
      );
    }
    if (surface.surface === 'project') {
      if (!slots.renderProjectWorkspace) {
        return <MainNotice>{ui.automation.workflowUnavailable}</MainNotice>;
      }
      return (
        <main className="flex min-w-0 flex-1 flex-col">
          {slots.renderProjectWorkspace({ typeId: surface.typeId })}
        </main>
      );
    }
    if (surface.surface === 'type' && selected) {
      // Маршрут ещё грузится, а на руках прежнего нет (первое открытие после
      // перезагрузки, новый тип): рама ждёт маршрут и появляется сразу с
      // графом — не пустым «Маршрутом», на котором потом вспыхивают граф и
      // кнопки бара. Отказ сервера — честное «недоступно», не пустота. Под
      // карточкой стека рама приостановлена — маршрут ей не нужен.
      if (!shown || (!workflow && !suspended)) {
        return workflowQuery.isError ? (
          <MainNotice>{ui.automation.workflowUnavailable}</MainNotice>
        ) : (
          blankMain
        );
      }
      return (
        <main className="flex min-w-0 flex-1 flex-col">
          <ProcessTypeCard
            type={shown ?? selected}
            workflow={shown ? workflow : undefined}
            suspended={suspended}
            renderProjectTypeCreate={slots.renderProjectTypeCreate}
          />
        </main>
      );
    }
    return <MainNotice>{ui.automation.createFirstType}</MainNotice>;
  }
}
