import { useEffect, useState, type ReactNode } from 'react';
import { Permission, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { ListChecks, Settings2, Share2, SlidersHorizontal } from 'lucide-react';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useCanManageWorkflows } from '../../../../shared/api/use-can-manage-workflows.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../../shared/auth-store.js';
import { useCanManageFields } from '../../../../shared/custom-fields/use-can-manage-fields.js';
import type { CardTabDef } from '../../../../shared/ui/entity-card/card-tab-strip.js';
import { TypeCardFrame, TypeCardPanel } from '../../../../shared/ui/type-card-frame.js';
import { useUpdateNodeKind } from '../api/node-kinds-api.js';
import type { RenderCreateField } from '../types.js';
import { NodeKindFormSection } from './node-kind-form-section.js';
import { NodeKindSettingsDialog } from './node-kind-settings-dialog.js';
import { kindUsageText } from './node-kind-summary.js';
import { NodeKindUsageSection } from './node-kind-usage-section.js';
import { NodeKindWorksSection } from './node-kind-works-section.js';

type ScreenSection = 'form' | 'works' | 'usage';

/**
 * Тип папки в разделе «Процессы» (#857; ревизия вкладок 26.11.2026) — ТА ЖЕ
 * рама, что у типа проекта и процесса, но вкладки — только БОЛЬШИЕ
 * поверхности: «Поля и форма» (конструктор формы), «Работы в папке» и «Где
 * используется» (журнальные списки). Имя, значок, цвет, возможности и архив
 * переехали в компактное окно настроек (из «⋯ → Настройки типа…» строки и
 * шестерёнки в полосе). «Показатели» и «Действия» скрыты до #865 — вернутся
 * настоящими списками. Левая колонка всегда видна, имя справа не дублируется.
 */
export function NodeKindScreen({
  kindId,
  backLabel,
  onBack,
  renderCreateField,
  onOpenProjectType,
  onOpenType,
  renderProcessTypeCreate,
  renderProjectTypeCreate,
  settingsRequest = 0,
}: {
  kindId: string;
  /** Имя типа проекта, из которого открыт тип (крошка «‹ Договор»). */
  backLabel?: string;
  onBack: () => void;
  renderCreateField?: RenderCreateField;
  onOpenProjectType: (id: string) => void;
  /** Переход в настройку маршрута типа задачи из «Работ в папке». */
  onOpenType?: (id: string) => void;
  /** Окна создания из списочных вкладок (слоты app, I6). */
  renderProcessTypeCreate?: (slot: {
    onClose: () => void;
    onCreated: (id: string) => void;
    baseId?: string;
  }) => ReactNode;
  renderProjectTypeCreate?: (slot: {
    onClose: () => void;
    onCreated: (id: string) => void;
    baseId?: string;
  }) => ReactNode;
  /** Счётчик команд «⋯ → Настройки типа…» строки колонки: открыть окно. */
  settingsRequest?: number;
}) {
  const kindsQuery = useNodeKinds();
  const kinds = kindsQuery.data ?? [];
  const kind = kinds.find((entry) => entry.id === kindId) ?? null;
  const { data: projectTypes } = useProjectTypes();
  const update = useUpdateNodeKind();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canSetup = permissions.includes(Permission.PROJECT_SETUP_MANAGE);
  const canManageWorkflows = useCanManageWorkflows();
  const canCreateField = useCanManageFields();

  const [section, setSection] = useState<ScreenSection>('form');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shownId, setShownId] = useState(kindId);
  // Смена типа — с первого раздела (derive-render).
  if (kindId !== shownId) {
    setShownId(kindId);
    setSection('form');
    setSettingsOpen(false);
  }
  // «⋯ → Настройки типа…» строки типа папки — окно настроек.
  useEffect(() => {
    if (settingsRequest > 0) setSettingsOpen(true);
  }, [settingsRequest]);

  // Идентификатор пропал (справочник перечитан без него) — откат к умолчанию.
  const missing = !kind && !kindsQuery.isLoading;
  useEffect(() => {
    if (missing) onBack();
  }, [missing, onBack]);

  if (!kind) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {kindsQuery.isLoading ? (
          <div className="flex flex-col gap-2 p-6">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-9 w-full max-w-xl" />
            <Skeleton className="h-9 w-full max-w-lg" />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty>
              <EmptyTitle>{ui.nodeKinds.empty}</EmptyTitle>
            </Empty>
          </div>
        )}
      </div>
    );
  }

  const idPrefix = `node-kind-${kind.id}`;
  const tabs: CardTabDef[] = [
    {
      id: 'form',
      label: ui.nodeKinds.screen.fieldsForm,
      icon: <SlidersHorizontal className="size-3.5" strokeWidth={1.75} />,
    },
    {
      id: 'works',
      label: ui.nodeKinds.screen.works,
      icon: <ListChecks className="size-3.5" strokeWidth={1.75} />,
    },
    {
      id: 'usage',
      label: ui.nodeKinds.screen.usage,
      icon: <Share2 className="size-3.5" strokeWidth={1.75} />,
    },
  ];

  return (
    <>
      <TypeCardFrame
        meta={kindUsageText(kind, projectTypes ?? []) || undefined}
        backLabel={backLabel}
        onBack={backLabel ? onBack : undefined}
        settingsAction={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSettingsOpen(true)}
            aria-label={ui.nodeKinds.panel.settingsTitle}
            title={ui.nodeKinds.panel.settingsTitle}
          >
            <Settings2 className="size-4" strokeWidth={1.75} />
          </Button>
        }
        tabs={tabs}
        activeTab={section}
        onActivateTab={(id) => setSection(id as ScreenSection)}
        idPrefix={idPrefix}
        tabsLabel={ui.nodeKinds.title}
      >
        {section === 'form' ? (
          <TypeCardPanel idPrefix={idPrefix} tab="form">
            <NodeKindFormSection
              kind={kind}
              canSetup={canSetup}
              canCreateField={canCreateField}
              renderCreateField={renderCreateField}
              onSave={(form) => update.mutate({ id: kind.id, form })}
            />
          </TypeCardPanel>
        ) : null}

        {section === 'works' ? (
          <TypeCardPanel idPrefix={idPrefix} tab="works">
            <NodeKindWorksSection
              kind={kind}
              canManage={canManageWorkflows}
              onOpenType={onOpenType ?? (() => undefined)}
              renderProcessTypeCreate={renderProcessTypeCreate}
            />
          </TypeCardPanel>
        ) : null}

        {section === 'usage' ? (
          <TypeCardPanel idPrefix={idPrefix} tab="usage">
            <NodeKindUsageSection
              kind={kind}
              onOpenProjectType={onOpenProjectType}
              renderProjectTypeCreate={renderProjectTypeCreate}
            />
          </TypeCardPanel>
        ) : null}
      </TypeCardFrame>

      {settingsOpen ? (
        <NodeKindSettingsDialog
          kind={kind}
          canSetup={canSetup}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </>
  );
}
