import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Permission, ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { Button } from '@nodus/ui/components/button';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { ClipboardList, FolderTree, Settings2, Workflow } from 'lucide-react';

import { useNodeKinds } from '../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { useCanManageFields } from '../../../shared/custom-fields/use-can-manage-fields.js';
import type { CardTabDef } from '../../../shared/ui/entity-card/card-tab-strip.js';
import { TypeCardFrame, TypeCardPanel } from '../../../shared/ui/type-card-frame.js';
import { kindsSummary } from '../lib/project-type-summary.js';
import type { RenderCreateField } from '../node-kinds/types.js';
import { ProjectSchemaCanvas } from './project-schema-canvas.js';
import { ProjectTypeCreationTab } from './project-type-creation.js';
import { ProjectTypeKindsTab } from './project-type-kinds.js';
import { ProjectTypeSettingsDialog } from './project-type-settings-dialog.js';
import { ProjectWindowBuilder } from './project-window-builder.js';

type WorkspaceTab = 'schema' | 'creation' | 'kinds';

/**
 * Тип проекта в разделе «Процессы» (#857) — окно настройки на всю правую
 * область в раме карточки проекта/письма (вердикт владельца 26.11.2026):
 * шапка с идентичностью типа и полоса вкладок `Схема` · `Настройки` · `Что
 * здесь можно создавать` · `Какие папки здесь бывают`. Холст — ПЕРВАЯ
 * вкладка (точечная сетка + узел «Создание проекта»), а не отдельный «центр
 * окна»: переключение вкладок меняет только содержимое рамы. Правых панелей
 * в потоке нет; окно создания проекта — окно поверх экрана (канон #496).
 */
export function ProjectTypeWorkspace({
  typeId,
  settingsRequest,
  onOpenType,
  onOpenKind,
  renderCreateField,
  renderProcessTypeCreate,
}: {
  typeId: string;
  /** Счётчик команд «⋯ → Настройки типа» строки проекта в колонке. */
  settingsRequest: number;
  onOpenType: (id: string) => void;
  onOpenKind: (id: string) => void;
  renderCreateField?: RenderCreateField;
  /** Окно создания типа задачи (слот automation, I6) — из «Что здесь можно создавать». */
  renderProcessTypeCreate?: (slot: {
    onClose: () => void;
    onCreated: (id: string) => void;
    baseId?: string;
  }) => ReactNode;
}) {
  const typesQuery = useProjectTypes(true);
  const kindsQuery = useNodeKinds();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canSetup = permissions.includes(Permission.PROJECT_SETUP_MANAGE);
  const canCreateField = useCanManageFields();

  const types = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);
  const kinds = useMemo(() => kindsQuery.data ?? [], [kindsQuery.data]);
  const type = useMemo(
    () => types.find((entry) => entry.id === typeId && entry.archivedAt === null) ?? null,
    [types, typeId],
  );

  const [tab, setTab] = useState<WorkspaceTab>('schema');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Смена типа (выбор другой строки колонки) — с первой вкладки (derive-render).
  const [shownId, setShownId] = useState(typeId);
  if (typeId !== shownId) {
    setShownId(typeId);
    setTab('schema');
    setBuilderOpen(false);
    setSettingsOpen(false);
  }

  // «⋯ → Настройки типа…» строки проекта: окно настроек выбранного типа.
  useEffect(() => {
    if (settingsRequest > 0) setSettingsOpen(true);
  }, [settingsRequest]);

  if (!type) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {typesQuery.isLoading ? (
          <div className="flex flex-col gap-2 p-6">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-9 w-full max-w-xl" />
            <Skeleton className="h-9 w-full max-w-lg" />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty>
              <EmptyTitle>{ui.projects.typesEmpty}</EmptyTitle>
            </Empty>
          </div>
        )}
      </div>
    );
  }

  const idPrefix = `project-type-${type.id}`;
  const tabs: CardTabDef[] = [
    {
      id: 'schema',
      label: ui.projects.schemasTabSchema,
      icon: <Workflow className="size-3.5" strokeWidth={1.75} />,
    },
    {
      id: 'creation',
      label: ui.projects.schemasCreationPage,
      icon: <ClipboardList className="size-3.5" strokeWidth={1.75} />,
    },
    {
      id: 'kinds',
      label: ui.projects.schemasKinds,
      icon: <FolderTree className="size-3.5" strokeWidth={1.75} />,
    },
  ];

  return (
    <>
      <TypeCardFrame
        meta={kindsSummary(type, kinds)}
        actions={
          tab === 'schema' ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setBuilderOpen(true)}
              aria-label={ui.projects.schemasWindowPanel}
              title={ui.projects.schemasWindowPanel}
            >
              <Settings2 className="size-4" strokeWidth={1.75} />
            </Button>
          ) : undefined
        }
        settingsAction={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSettingsOpen(true)}
            aria-label={ui.automation.typeSettings.title}
            title={ui.automation.typeSettings.title}
          >
            <Settings2 className="size-4" strokeWidth={1.75} />
          </Button>
        }
        tabs={tabs}
        activeTab={tab}
        onActivateTab={(id) => setTab(id as WorkspaceTab)}
        idPrefix={idPrefix}
        tabsLabel={ui.projects.schemasTabsAria}
      >
        {tab === 'schema' ? (
          <TypeCardPanel idPrefix={idPrefix} tab="schema">
            <ProjectSchemaCanvas
              type={type}
              canSetup={canSetup}
              onOpenWindow={() => setBuilderOpen(true)}
            />
          </TypeCardPanel>
        ) : null}
        {tab === 'creation' ? (
          <TypeCardPanel idPrefix={idPrefix} tab="creation">
            <ProjectTypeCreationTab
              type={type}
              canSetup={canSetup}
              onOpenType={onOpenType}
              renderProcessTypeCreate={renderProcessTypeCreate}
            />
          </TypeCardPanel>
        ) : null}
        {tab === 'kinds' ? (
          <TypeCardPanel idPrefix={idPrefix} tab="kinds">
            <ProjectTypeKindsTab
              type={type}
              kinds={kinds}
              canSetup={canSetup}
              onOpenKind={onOpenKind}
            />
          </TypeCardPanel>
        ) : null}
      </TypeCardFrame>
      {settingsOpen ? (
        <ProjectTypeSettingsDialog
          type={type}
          canSetup={canSetup}
          onEditWindow={() => {
            setSettingsOpen(false);
            setBuilderOpen(true);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      <ProjectWindowBuilder
        open={builderOpen}
        type={type}
        canSetup={canSetup}
        canCreateField={canCreateField}
        renderCreateField={renderCreateField}
        onClose={() => setBuilderOpen(false)}
      />
    </>
  );
}
