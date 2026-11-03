import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useQueryClient } from '@tanstack/react-query';
import { checkWorkflowDocument, typeIdsOf } from '@nodus/contracts';
import type { ProcessType, WorkflowDetail, WorkflowProblem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Plus } from 'lucide-react';

import { workflowKeys } from '../../../../shared/workflow/workflow-api.js';
import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { projectsAvailable } from '../../../../shared/api/projects-available.js';
import { ROUTE_GEOMETRY } from '../../../../shared/flow/route-layout.js';
import { usePublishWorkflow, useStageNames } from '../../api/automation-api.js';
import { useCanManageWorkflows } from '../../lib/use-can-manage-workflows.js';
import { useRouteDocStore } from '../../model/route-doc-store.js';
import { useLayoutAutosave } from '../../model/use-layout-autosave.js';
import { AddTransitionPopover } from './add-transition-popover.js';
import {
  CatalogLockBanner,
  DraftBanner,
  NavigationGuard,
  StaleDraftBanner,
} from './editor-parts.js';
import { EditorPanel } from './panel/editor-panel.js';
import { SIDE_PANEL_WIDTH } from '../../../../shared/ui/panel/side-panel.js';
import { PublishDialog } from './publish-dialog.js';
import { RouteCanvas } from './route-canvas.js';
import { RouteToolbar } from './route-toolbar.js';

/**
 * Редактор маршрута (#378 ред. 2, реф Jira workflow editor / Трекер) —
 * окно-сплит как в мессенджере: колонка холста (верхний бар h-14 с линией —
 * добавление сверху, публикация не уезжает; холст `RouteCanvas` — общая
 * раскладка, точки подключения, подписи на стрелках, масштаб и отмена слева
 * внизу) и правые панели — полновысотные колонки, которые выезжают справа и
 * СУЖАЮТ холст (граф стоит, край обрезает). Живые проверки
 * `checkWorkflowDocument`, публикация.
 */
interface RouteEditorProps {
  type: ProcessType;
  workflow: WorkflowDetail;
  /** Панель «Настройки типа» (та же колонка справа, монтирована всегда) и
   *  открыта ли она сейчас — новый статус ставится в видимую часть холста. */
  settings?: React.ReactNode;
  settingsOpen?: boolean;
}

export function RouteEditor(props: RouteEditorProps) {
  return (
    <ReactFlowProvider>
      <RouteEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function RouteEditorInner({ type, workflow, settings, settingsOpen = false }: RouteEditorProps) {
  const doc = useRouteDocStore((s) => s.document);
  const dirty = useRouteDocStore((s) => s.dirty);
  const selection = useRouteDocStore((s) => s.selection);
  const draftSavedAt = useRouteDocStore((s) => s.draftSavedAt);
  const staleDraftAt = useRouteDocStore((s) => s.staleDraftAt);
  const pendingReload = useRouteDocStore((s) => s.pendingReload);
  // Правка закрыта без права, пока после публикации не пришла свежая версия,
  // и всегда — у письма: каталог типов писем системный (#55, Р4).
  const locked = type.category === 'letter';
  const canManage = useCanManageWorkflows() && !pendingReload && !locked;
  const publish = usePublishWorkflow(workflow.id);
  const queryClient = useQueryClient();
  const { fitView, screenToFlowPosition } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  // Загрузка/перезагрузка маршрута в стор (смена типа, своя или чужая
  // публикация — новая версия сервера).
  useEffect(() => {
    useRouteDocStore.getState().sync(workflow);
  }, [workflow]);
  // Расстановка холста сохраняется сама — без черновика и новой версии.
  useLayoutAutosave(workflow.id, canManage);

  // Атрибуты в окне, гейтах и форме создания (#431, #432): неизвестный —
  // ошибка публикации, скрытый в окне — предупреждение, чужой типу — ошибка;
  // факты — из реестра области и привязок типа.
  const { data: customFieldDefinitions } = useCustomFieldDefinitions(type.category);
  const customFieldFacts = useMemo(
    () =>
      customFieldDefinitions
        ? {
            active: new Set(customFieldDefinitions.map((d) => d.id)),
            hidden: new Set(customFieldDefinitions.filter((d) => d.hidden).map((d) => d.id)),
            inType: new Set(
              customFieldDefinitions.filter((d) => typeIdsOf(d).includes(type.id)).map((d) => d.id),
            ),
          }
        : undefined,
    [customFieldDefinitions, type.id],
  );
  const definitions = useMemo(
    () =>
      customFieldDefinitions?.map((d) => ({
        id: d.id,
        type: d.type,
        settings: d.settings,
        hidden: d.hidden,
      })),
    [customFieldDefinitions],
  );
  // Мягкий каталог имён статусов (#430): подсказки и warning-и имён.
  const { data: stageNames = [], isLoading: stageNamesLoading } = useStageNames(
    type.category,
    workflow.id,
    canManage,
  );
  const stageNameFacts = useMemo(
    () =>
      stageNames.filter((s) => s.published).map(({ systemState, name }) => ({ systemState, name })),
    [stageNames],
  );
  const problems = useMemo(
    () =>
      checkWorkflowDocument(doc, {
        customFields: customFieldFacts,
        category: type.category,
        definitions,
        projectsAvailable: projectsAvailable(),
        stageNameFacts,
      }),
    [doc, customFieldFacts, definitions, type.category, stageNameFacts],
  );
  const problemStageIds = useMemo(
    () => new Set(problems.filter((p) => p.stageId).map((p) => p.stageId as string)),
    [problems],
  );

  // Несохранённые правки: предупреждение при закрытии вкладки.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const panelOpen = selection !== null || settingsOpen;

  /** «Добавить статус»: «Новый статус» группы «В работе» в центре видимой
   *  части холста — с учётом панели, которая сейчас выедет и сузит холст, —
   *  без наложения на соседей. */
  const addStage = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const visible = panelOpen
      ? rect.width
      : Math.max(rect.width - SIDE_PANEL_WIDTH, rect.width / 2);
    const center = screenToFlowPosition({
      x: rect.left + visible / 2,
      y: rect.top + rect.height / 2,
    });
    const { stageWidth: w, stageHeight: h, rowGap } = ROUTE_GEOMETRY;
    const taken = Object.values(useRouteDocStore.getState().document.layout?.stages ?? {});
    const position = { x: center.x - w / 2, y: center.y - h / 2 };
    while (taken.some((p) => Math.abs(p.x - position.x) < w && Math.abs(p.y - position.y) < h)) {
      position.y += h + rowGap / 2;
    }
    useRouteDocStore.getState().addStage('active', position);
  };

  const onProblemClick = (problem: WorkflowProblem) => {
    const store = useRouteDocStore.getState();
    // Проблема формы создания (#432) — панель окна создания, слот подсвечен.
    if (problem.creationField) {
      store.select({ kind: 'creation', id: 'creation', field: problem.creationField });
      return;
    }
    if (problem.transitionId) store.select({ kind: 'transition', id: problem.transitionId });
    else if (problem.stageId) store.select({ kind: 'stage', id: problem.stageId });
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <RouteToolbar
          type={type}
          canManage={canManage}
          dirty={dirty}
          publishedAt={dirty ? null : workflow.publishedAt}
          publishedBy={workflow.publishedBy?.displayName ?? null}
          problems={problems}
          publishBlocked={!dirty}
          onAddStage={addStage}
          addTransition={
            <AddTransitionPopover
              document={doc}
              onPick={(from, to) => useRouteDocStore.getState().addTransition(from, to)}
              trigger={
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  title={ui.automation.addTransitionLabel}
                >
                  <Plus className="size-3.5" strokeWidth={1.75} />
                  <span className="@max-[760px]:hidden">{ui.automation.addTransitionLabel}</span>
                </Button>
              }
            />
          }
          onTidy={() => {
            // «Упорядочить»: авторасстановка в общую раскладку и вписать.
            useRouteDocStore.getState().arrange();
            void fitView({ duration: 200, padding: 0.2, maxZoom: 1 });
          }}
          onProblemClick={onProblemClick}
          onDiscard={() => useRouteDocStore.getState().discard()}
          onPublish={() => {
            // Счётчики предпросмотра — свежие: staleTime detail 30 с не
            // должен решать, сколько задач «в полёте».
            void queryClient.invalidateQueries({ queryKey: workflowKeys.detail(workflow.id) });
            setPublishOpen(true);
          }}
        />

        <div ref={canvasRef} className="relative min-h-0 flex-1 overflow-hidden">
          <RouteCanvas workflow={workflow} editable={canManage} problemStageIds={problemStageIds} />
          {locked ? <CatalogLockBanner text={ui.automation.letterCatalogLocked} /> : null}
          {dirty && draftSavedAt ? (
            <DraftBanner
              savedAt={draftSavedAt}
              onReset={() => useRouteDocStore.getState().discard()}
            />
          ) : null}
          {staleDraftAt && !dirty ? (
            <StaleDraftBanner onReset={() => useRouteDocStore.getState().discard()} />
          ) : null}
        </div>
      </div>

      <EditorPanel
        workflow={workflow}
        type={type}
        scope={type.category}
        readOnly={!canManage}
        stageNameSuggestions={stageNames}
        stageNameLoading={stageNamesLoading}
      />
      {settings}
      <NavigationGuard dirty={dirty} />

      {publishOpen ? (
        <PublishDialog
          open
          onClose={() => setPublishOpen(false)}
          workflow={workflow}
          baseline={useRouteDocStore.getState().baseline}
          document={doc}
          baseVersion={useRouteDocStore.getState().baseVersion}
          problems={problems}
          publish={publish}
          onPublished={() => useRouteDocStore.getState().markPublished()}
          onConflictLoad={() => {
            setPublishOpen(false);
            // Свежая версия: сброс правок + рефеч маршрута (useEffect загрузки
            // подхватит новую версию и baseVersion — повторный 409 исключён).
            useRouteDocStore.getState().discard();
            publish.reset();
            void queryClient.invalidateQueries({ queryKey: workflowKeys.detail(workflow.id) });
          }}
        />
      ) : null}
    </div>
  );
}
