import { useMemo, useState, type ReactNode } from 'react';
import { Permission, ui } from '@nodus/contracts';
import type { NodeKind, ProjectType } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { ClipboardList, FilePenLine, FolderTree, Workflow } from 'lucide-react';

import { useNodeKinds } from '../../../shared/api/node-kinds.js';
import { useProjectTypes } from '../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { useCanManageFields } from '../../../shared/custom-fields/use-can-manage-fields.js';
import type { CardTabDef } from '../../../shared/ui/entity-card/card-tab-strip.js';
import {
  FrameSettingsButton,
  TypeCardFrame,
  TypeCardPanel,
} from '../../../shared/ui/type-card-frame.js';
import { useTypeSettingsStore } from '../../../shared/ui/type-settings-store.js';
import { FormSaveState } from '../../../shared/forms/builder/form-autosave.js';
import type { RenderCreateField } from '../node-kinds/types.js';
import { ProjectSchemaCanvas } from './project-schema-canvas.js';
import { ProjectTypeCreationTab } from './project-type-creation.js';
import { ProjectTypeFormTab, useProjectTypeForm } from './project-type-form-tab.js';
import { ProjectTypeKindsTab } from './project-type-kinds.js';

type WorkspaceTab = 'schema' | 'form' | 'creation' | 'kinds';

/** Окно создания типа задачи (слот фичи automation, I6) — из «Что здесь можно создавать». */
interface ProcessTypeCreateSlot {
  onClose: () => void;
  onCreated: (id: string) => void;
  baseId?: string;
}

/**
 * Тип проекта в разделе «Процессы» (#857) — рабочая область в раме карточки
 * (вердикт владельца 26.11.2026; ревизия UI v3): полоса вкладок `Схема` ·
 * `Форма создания` · `Что здесь можно создавать` · `Какие папки здесь бывают`
 * — одна схема на все сущности: схема → форма → связи → мелочь в окне
 * настроек. Холст — ПЕРВАЯ вкладка (точечная сетка + узел «Создание проекта»),
 * а не отдельный «центр окна»: переключение вкладок меняет только
 * содержимое рамы. Бар — как у остальных карточек: вкладки, слева от
 * шестерёнки тихая строка автосохранения формы, справа шестерёнка настроек.
 * Связанные сущности (тип задачи, тип папки) открываются карточкой ПОВЕРХ
 * стека прямо из строк списков — рама никуда не переезжает, крошек «назад»
 * нет. Настройки типа рендерит общий хост уровня app (`TypeSettingsHost`) —
 * открываются и из карточки этого типа.
 */
export function ProjectTypeWorkspace({
  typeId,
  renderProcessTypeCreate,
  renderCreateField,
}: {
  typeId: string;
  renderProcessTypeCreate?: (slot: ProcessTypeCreateSlot) => ReactNode;
  /** Окно «Создать атрибут» из лотка формы (слот app, I6). */
  renderCreateField?: RenderCreateField;
}) {
  const typesQuery = useProjectTypes(true);
  const kindsQuery = useNodeKinds();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canSetup = permissions.includes(Permission.PROJECT_SETUP_MANAGE);

  const types = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);
  const kinds = useMemo(() => kindsQuery.data ?? [], [kindsQuery.data]);
  const type = useMemo(
    () => types.find((entry) => entry.id === typeId && entry.archivedAt === null) ?? null,
    [types, typeId],
  );

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

  // Смена типа (выбор другой строки колонки) — новая рама с первой вкладки:
  // прежняя, размонтируясь, сразу сохраняет недавнюю правку формы.
  return (
    <ProjectTypeFrame
      key={type.id}
      type={type}
      kinds={kinds}
      canSetup={canSetup}
      renderProcessTypeCreate={renderProcessTypeCreate}
      renderCreateField={renderCreateField}
    />
  );
}

function ProjectTypeFrame({
  type,
  kinds,
  canSetup,
  renderProcessTypeCreate,
  renderCreateField,
}: {
  type: ProjectType;
  kinds: NodeKind[];
  canSetup: boolean;
  renderProcessTypeCreate?: (slot: ProcessTypeCreateSlot) => ReactNode;
  renderCreateField?: RenderCreateField;
}) {
  const form = useProjectTypeForm(type);
  const canCreateField = useCanManageFields();
  const openSettings = useTypeSettingsStore((s) => s.openSettings);
  const [tab, setTab] = useState<WorkspaceTab>('schema');
  const activate = (id: string) => {
    // Уходя с вкладки формы, сохраняем недавнюю правку сразу.
    if (tab === 'form' && id !== 'form') form.flush();
    setTab(id as WorkspaceTab);
  };

  const idPrefix = `project-type-${type.id}`;
  const tabs: CardTabDef[] = [
    {
      id: 'schema',
      label: ui.projects.schemasTabSchema,
      icon: <Workflow className="size-3.5" strokeWidth={1.75} />,
    },
    {
      id: 'form',
      label: ui.automation.entry.formTab,
      icon: <FilePenLine className="size-3.5" strokeWidth={1.75} />,
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
    <TypeCardFrame
      quiet={<FormSaveState state={form.state} onRetry={form.retry} />}
      settingsAction={
        <FrameSettingsButton
          label={ui.automation.menuSettingsType}
          onClick={() => openSettings({ kind: 'project-type', id: type.id })}
        />
      }
      tabs={tabs}
      activeTab={tab}
      onActivateTab={activate}
      idPrefix={idPrefix}
      tabsLabel={ui.projects.schemasTabsAria}
    >
      {tab === 'schema' ? (
        <TypeCardPanel idPrefix={idPrefix} tab="schema">
          <ProjectSchemaCanvas
            type={type}
            canSetup={canSetup}
            onOpenForm={() => activate('form')}
          />
        </TypeCardPanel>
      ) : null}
      {tab === 'form' ? (
        <TypeCardPanel idPrefix={idPrefix} tab="form">
          <ProjectTypeFormTab
            type={type}
            canSetup={canSetup}
            canCreateField={canCreateField}
            renderCreateField={renderCreateField}
            form={form}
          />
        </TypeCardPanel>
      ) : null}
      {tab === 'creation' ? (
        <TypeCardPanel idPrefix={idPrefix} tab="creation">
          <ProjectTypeCreationTab
            type={type}
            canSetup={canSetup}
            renderProcessTypeCreate={renderProcessTypeCreate}
          />
        </TypeCardPanel>
      ) : null}
      {tab === 'kinds' ? (
        <TypeCardPanel idPrefix={idPrefix} tab="kinds">
          <ProjectTypeKindsTab type={type} kinds={kinds} canSetup={canSetup} />
        </TypeCardPanel>
      ) : null}
    </TypeCardFrame>
  );
}
