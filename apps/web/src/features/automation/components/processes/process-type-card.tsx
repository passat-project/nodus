import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProcessType, WorkflowDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { MapPin, Settings2, Workflow } from 'lucide-react';

import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useCanManageWorkflows } from '../../../../shared/api/use-can-manage-workflows.js';
import type { CardTabDef } from '../../../../shared/ui/entity-card/card-tab-strip.js';
import { TypeCardFrame, TypeCardPanel } from '../../../../shared/ui/type-card-frame.js';
import { RouteEditor } from '../editor/route-editor.js';
import { creationUsageText } from './unified-meta.js';
import { ProcessTypeCreationTab } from './process-type-creation-tab.js';
import { ProcessTypeSettingsDialog } from './process-type-settings-dialog.js';

type ProcessTab = 'route' | 'creation';

/**
 * Карточка типа процесса (задачи или письма) в «Процессах» (#857; ревизия
 * вкладок 26.11.2026): ОДНА рама для всех сущностей, вкладки — только
 * большие поверхности: «Маршрут» (редактор целиком) и «Где создаётся»
 * (список типов проектов на всю ширину). Вся «мелочь» — имя, значок, цвет,
 * описание, доступ, блоки, роли, нумерация, архив — в компактном окне
 * настроек (`ProcessTypeSettingsDialog`, стиль окна атрибута): открывается
 * из «⋯ → Настройки типа…» строки колонки и шестерёнкой в полосе вкладок.
 * Действия редактора (опубликовать, статус, переход) — в правой части той же
 * полосы, второго верхнего бара нет. Имя типа справа не дублируется.
 */
export function ProcessTypeCard({
  type,
  workflow,
  settingsRequest = 0,
  backLabel,
  onBack,
  renderProjectTypeCreate,
}: {
  type: ProcessType;
  workflow: WorkflowDetail;
  /** Счётчик команд «⋯ → Настройки типа…» строки колонки: открыть окно. */
  settingsRequest?: number;
  /** Имя типа проекта, из которого открыт маршрут (крошка «‹ Договор»). */
  backLabel?: string;
  onBack: () => void;
  /** Окно создания типа проекта (слот фичи projects, I6). */
  renderProjectTypeCreate?: (slot: {
    onClose: () => void;
    onCreated: (id: string) => void;
    baseId?: string;
  }) => ReactNode;
}) {
  const { data: projectTypes } = useProjectTypes();
  const canManage = useCanManageWorkflows();
  const aliveProjects = useMemo(
    () => (projectTypes ?? []).filter((project) => project.archivedAt === null),
    [projectTypes],
  );
  const usage = creationUsageText(type, aliveProjects);
  const locked = type.category !== 'task';
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<ProcessTab>('route');
  const [shownId, setShownId] = useState(type.id);
  if (type.id !== shownId) {
    setShownId(type.id);
    setTab('route');
    setSettingsOpen(false);
  }
  // «⋯ → Настройки типа…» строки задачи/письма — окно настроек.
  useEffect(() => {
    if (settingsRequest > 0) setSettingsOpen(true);
  }, [settingsRequest]);

  const idPrefix = `process-type-${type.id}`;
  const tabs: CardTabDef[] = [
    {
      id: 'route',
      label: ui.automation.typeSettings.tabRoute,
      icon: <Workflow className="size-3.5" strokeWidth={1.75} />,
    },
    {
      id: 'creation',
      label: ui.automation.typeSettings.sections.creation,
      icon: <MapPin className="size-3.5" strokeWidth={1.75} />,
    },
  ];

  return (
    <>
      <TypeCardFrame
        meta={
          locked ? (
            <span className="flex min-w-0 items-center gap-2">
              {usage ? <span className="truncate">{usage}</span> : null}
              <NodeChip tone="muted" className="shrink-0">
                {ui.automation.readOnly}
              </NodeChip>
            </span>
          ) : (
            (usage ?? undefined)
          )
        }
        backLabel={backLabel}
        onBack={backLabel ? onBack : undefined}
        actions={
          tab === 'route' ? (
            <div ref={setActionsHost} className="flex h-full items-center gap-1.5" />
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
        onActivateTab={(id) => setTab(id as ProcessTab)}
        idPrefix={idPrefix}
        tabsLabel={ui.automation.typeSettings.title}
      >
        {tab === 'route' ? (
          <TypeCardPanel idPrefix={idPrefix} tab="route">
            <RouteEditor type={type} workflow={workflow} actionsHost={actionsHost} />
          </TypeCardPanel>
        ) : null}

        {tab === 'creation' ? (
          <TypeCardPanel idPrefix={idPrefix} tab="creation">
            <ProcessTypeCreationTab
              type={type}
              canSave={canManage && !locked}
              renderProjectTypeCreate={renderProjectTypeCreate}
            />
          </TypeCardPanel>
        ) : null}
      </TypeCardFrame>

      {settingsOpen ? (
        <ProcessTypeSettingsDialog type={type} onClose={() => setSettingsOpen(false)} />
      ) : null}
    </>
  );
}
