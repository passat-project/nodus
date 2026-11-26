import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Permission, ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';

import { useProcessTypes } from '../../api/automation-api.js';
import { useCanManageWorkflows } from '../../../../shared/api/use-can-manage-workflows.js';
import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../../shared/auth-store.js';
import { useCanManageFields } from '../../../../shared/custom-fields/use-can-manage-fields.js';
import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { useWorkflowDetail } from '../../../../shared/workflow/workflow-api.js';
import { FieldDialog } from '../fields/field-dialog.js';
import { useRouteDocStore } from '../../model/route-doc-store.js';
import { RouteEditor } from '../editor/route-editor.js';
import { TypeSettingsPanel } from '../types/type-settings.js';
import { resolveProcessesSurface, type ProcessesSearch } from './resolve-surface.js';
import { TypeTrail } from './type-trail.js';
import { UnifiedTypeList } from './unified-type-list.js';
import { WithoutProjectPage } from './without-project-page.js';

/** Слот «Создать атрибут…» (прецедент #556): окно атрибута с областью
 *  «Папка» — код фичи automation, вызывающие — projects (I6). */
export interface CreateFieldSlot {
  onClose: () => void;
  onCreated: (id: string) => void;
}
export type RenderCreateField = (slot: CreateFieldSlot) => ReactNode;

/** Слот рабочей области типа проекта (features/projects, #857). */
export interface ProjectWorkspaceSlot {
  typeId: string;
  /** Счётчик команд «⋯ → Настройки типа» строки проекта (открыть панель). */
  settingsRequest: number;
  onOpenType: (id: string) => void;
  onOpenKind: (id: string) => void;
  renderCreateField?: RenderCreateField;
}
export type RenderProjectWorkspace = (slot: ProjectWorkspaceSlot) => ReactNode;

/** Слот окна создания (тип проекта / тип папки — features/projects). */
export interface CreateDialogSlot {
  onClose: () => void;
  onCreated: (id: string) => void;
  baseId?: string;
}
export type RenderCreateDialog = (slot: CreateDialogSlot) => ReactNode;

export interface ProcessesScreenSlots {
  renderProjectWorkspace?: RenderProjectWorkspace;
  renderProjectTypeCreate?: RenderCreateDialog;
  renderKindCreate?: RenderCreateDialog;
  /** Архив/возврат типа проекта и типа папки — мутации фичи projects (I6). */
  onArchiveProject: (id: string, archived: boolean) => void;
  onArchiveNodeKind: (id: string, archived: boolean) => void;
}

/**
 * Вкладка «Процессы» — единый вход настройки процессов (#857, единая
 * модель §5): слева колонка из четырёх групп (Проекты с «Без проекта»,
 * Задачи, Письма, Папки), справа — по выбору: редактор маршрута (возможно,
 * с дорожкой из типа проекта), рабочая область типа проекта (слот фичи
 * projects), страница «Без проекта». `?ftype=` открывает экран типа папки
 * на всю область — его перехватывает `AutomationRoute` до этого экрана.
 * URL-модель и приоритеты — `resolve-surface.ts`.
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

  // Настройки типа открываются ДЛЯ КОНКРЕТНОЙ строки (#409): boolean терял
  // id, и панель всегда показывала selected. Выделение редактора не меняется.
  const [settingsTypeId, setSettingsTypeId] = useState<string | null>(null);
  const [projectSettingsRequest, setProjectSettingsRequest] = useState(0);

  const alive = useMemo(() => (types ?? []).filter((t) => !t.archivedAt), [types]);
  const selected =
    surface.surface === 'type' ? (alive.find((t) => t.id === surface.typeId) ?? null) : null;
  const settingsType = useMemo(
    () => alive.find((t) => t.id === settingsTypeId) ?? null,
    [alive, settingsTypeId],
  );
  const settingsOpen = settingsType !== null;
  // Тип заархивировали/удалили, пока панель открыта — панель закрывается.
  useEffect(() => {
    if (settingsTypeId !== null && settingsType === null) setSettingsTypeId(null);
  }, [settingsTypeId, settingsType]);

  const workflowQuery = useWorkflowDetail(selected?.workflowId ?? null);
  const workflow = workflowQuery.data;

  // Одна правая панель за раз: выделение на холсте закрывает «Настройки
  // типа», открытие настроек снимает выделение.
  const editorSelection = useRouteDocStore((s) => s.selection);
  useEffect(() => {
    if (editorSelection) setSettingsTypeId(null);
  }, [editorSelection]);
  const editorDirty = useRouteDocStore((s) => s.dirty);
  const editorWorkflowId = useRouteDocStore((s) => s.workflowId);
  const dirtyTypeIds = useMemo(() => {
    // Черновик редактора относится к одному маршруту — помечаем его строку.
    if (!editorDirty || !workflow || editorWorkflowId !== workflow.id) return new Set<string>();
    return new Set([selected?.id ?? '']);
  }, [editorDirty, editorWorkflowId, workflow, selected?.id]);

  const go = useCallback(
    (patch: Record<string, string | undefined>) =>
      void navigate({
        to: '/automation',
        search: (prev) => ({ ...prev, ...patch }),
      }),
    [navigate],
  );

  // Слот «Создать атрибут…» для рабочей области типа проекта: окно
  // атрибута — код этой фичи (прецедент renderCreateField, I6).
  const definitions = useCustomFieldDefinitions();
  const canCreateField = useCanManageFields();
  const renderCreateField = useCallback(
    (slot: CreateFieldSlot) => (
      <FieldDialog
        mode={{ kind: 'create' }}
        definitions={definitions.data ?? []}
        canManage={canCreateField}
        onClose={slot.onClose}
        onSaved={slot.onCreated}
        onOpenDefinition={slot.onCreated}
      />
    ),
    [definitions.data, canCreateField],
  );

  const trailType =
    surface.surface === 'type' && surface.trailTypeId
      ? (projectTypes.find((p) => p.id === surface.trailTypeId) ?? null)
      : null;

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
          setSettingsTypeId(null);
          go({ type: id, ptype: undefined, noproject: undefined });
        }}
        onOpenProcessTypeSettings={(id) => {
          useRouteDocStore.getState().select(null);
          setSettingsTypeId(id);
        }}
        onSelectProjectType={(id) => {
          setSettingsTypeId(null);
          go({ ptype: id, type: undefined, noproject: undefined });
        }}
        onOpenProjectSettings={(id) => {
          setSettingsTypeId(null);
          go({ ptype: id, type: undefined, noproject: undefined });
          setProjectSettingsRequest((count) => count + 1);
        }}
        onSelectNoProject={() => {
          setSettingsTypeId(null);
          go({ noproject: '1', ptype: undefined, type: undefined });
        }}
        onSelectKind={(id) => {
          setSettingsTypeId(null);
          go({ ftype: id, ptype: undefined });
        }}
        onArchiveProject={slots.onArchiveProject}
        onArchiveNodeKind={slots.onArchiveNodeKind}
        renderProjectTypeCreate={slots.renderProjectTypeCreate}
        renderKindCreate={slots.renderKindCreate}
      />

      {renderMain()}
    </div>
  );

  function renderMain(): ReactNode {
    if (surface.surface === 'folder') {
      // Экран типа папки открывает AutomationRoute на всю область; сюда
      // попадаем, только если перехват не сработал — колонку не прячем.
      return null;
    }
    if (surface.surface === 'no-project') {
      return (
        <main className="flex min-w-0 flex-1 flex-col">
          <WithoutProjectPage canManage={canManage} />
        </main>
      );
    }
    if (surface.surface === 'project' && slots.renderProjectWorkspace) {
      return (
        <main className="flex min-w-0 flex-1 flex-col">
          {slots.renderProjectWorkspace({
            typeId: surface.typeId,
            settingsRequest: projectSettingsRequest,
            onOpenType: (id) => go({ type: id, ptype: surface.typeId, noproject: undefined }),
            onOpenKind: (id) => go({ ftype: id, ptype: surface.typeId }),
            renderCreateField,
          })}
        </main>
      );
    }
    if (surface.surface === 'type' && selected && workflow) {
      return (
        <main className="flex min-w-0 flex-1 flex-col">
          {trailType ? (
            <TypeTrail
              from={trailType}
              to={selected}
              onBackToProject={() => go({ type: undefined })}
            />
          ) : null}
          <RouteEditor
            type={selected}
            workflow={workflow}
            settingsOpen={settingsOpen}
            settings={
              <TypeSettingsPanel
                open={settingsOpen}
                type={settingsType ?? selected}
                readOnly={!canManage}
                onClose={() => setSettingsTypeId(null)}
              />
            }
          />
        </main>
      );
    }
    return (
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center">
          <Empty>
            <EmptyTitle>
              {surface.surface === 'type' || surface.surface === 'empty'
                ? ui.automation.createFirstType
                : ui.automation.workflowUnavailable}
            </EmptyTitle>
          </Empty>
        </div>
      </main>
    );
  }
}
