import { useEffect, useState, type ReactNode } from 'react';
import { Permission, ui } from '@nodus/contracts';
import type { NodeKind } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { FilePenLine, ListChecks, Share2 } from 'lucide-react';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useCanManageWorkflows } from '../../../../shared/api/use-can-manage-workflows.js';
import { useAuthStore } from '../../../../shared/auth-store.js';
import { useCanManageFields } from '../../../../shared/custom-fields/use-can-manage-fields.js';
import type { CardTabDef } from '../../../../shared/ui/entity-card/card-tab-strip.js';
import {
  FrameSettingsButton,
  TypeCardFrame,
  TypeCardPanel,
} from '../../../../shared/ui/type-card-frame.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';
import { FormSaveState } from '../../../../shared/forms/builder/form-autosave.js';
import type { RenderCreateField } from '../types.js';
import { NodeKindFormTab, useNodeKindForm } from './node-kind-form-tab.js';
import { NodeKindUsageSection } from './node-kind-usage-section.js';
import { NodeKindWorksSection } from './node-kind-works-section.js';

type ScreenSection = 'form' | 'works' | 'usage';

/** Окно создания типа (слот app, I6) — из списочных вкладок. */
interface TypeCreateSlot {
  onClose: () => void;
  onCreated: (id: string) => void;
  baseId?: string;
}

/**
 * Тип папки в разделе «Процессов» (#857; ревизия UI v3) — ТА ЖЕ рама, что у
 * типа проекта и процесса, и в рабочей области, и в карточке стека; вкладки —
 * только БОЛЬШИЕ поверхности: «Форма создания» (редактор окна целиком, с
 * автосохранением), «Типы задач в папке» и «Где используется». Имя, значок,
 * цвет, возможности и архив живут в окне настроек общего стора (шестерёнка
 * бара и «⋯ → Настройки типа…»). Строка списка открывает карточку связанной
 * сущности ПОВЕРХ стека — переходов рамы «внутрь другого типа» и крошек
 * «назад» нет. Левая колонка всегда видна, имя справа не дублируется.
 */
export function NodeKindScreen({
  kindId,
  onMissing,
  renderCreateField,
  renderProcessTypeCreate,
  renderProjectTypeCreate,
}: {
  kindId: string;
  /** Типа больше нет (справочник перечитан без него): рама уходит на
   *  поверхность по умолчанию, карточка стека закрывается. */
  onMissing: () => void;
  /** Окно «Создать атрибут» из лотка формы (слот app, I6). */
  renderCreateField?: RenderCreateField;
  /** Окна создания из списочных вкладок (слоты app, I6). */
  renderProcessTypeCreate?: (slot: TypeCreateSlot) => ReactNode;
  renderProjectTypeCreate?: (slot: TypeCreateSlot) => ReactNode;
}) {
  const kindsQuery = useNodeKinds();
  const kinds = kindsQuery.data ?? [];
  const kind = kinds.find((entry) => entry.id === kindId) ?? null;
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canSetup = permissions.includes(Permission.PROJECT_SETUP_MANAGE);
  const canManageWorkflows = useCanManageWorkflows();

  // Идентификатор пропал (справочник перечитан без него) — откат к умолчанию.
  const missing = !kind && !kindsQuery.isLoading;
  useEffect(() => {
    if (missing) onMissing();
  }, [missing, onMissing]);

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

  // Смена типа (выбор другой строки колонки) — новая рама с первой вкладки:
  // прежняя, размонтируясь, сразу сохраняет недавнюю правку формы.
  return (
    <NodeKindFrame
      key={kind.id}
      kind={kind}
      canSetup={canSetup}
      canManageWorkflows={canManageWorkflows}
      renderCreateField={renderCreateField}
      renderProcessTypeCreate={renderProcessTypeCreate}
      renderProjectTypeCreate={renderProjectTypeCreate}
    />
  );
}

function NodeKindFrame({
  kind,
  canSetup,
  canManageWorkflows,
  renderCreateField,
  renderProcessTypeCreate,
  renderProjectTypeCreate,
}: {
  kind: NodeKind;
  canSetup: boolean;
  canManageWorkflows: boolean;
  renderCreateField?: RenderCreateField;
  renderProcessTypeCreate?: (slot: TypeCreateSlot) => ReactNode;
  renderProjectTypeCreate?: (slot: TypeCreateSlot) => ReactNode;
}) {
  const form = useNodeKindForm(kind);
  const canCreateField = useCanManageFields();
  const openSettings = useTypeSettingsStore((s) => s.openSettings);
  const [section, setSection] = useState<ScreenSection>('form');
  const activate = (id: string) => {
    // Уходя с вкладки формы, сохраняем недавнюю правку сразу.
    if (section === 'form' && id !== 'form') form.flush();
    setSection(id as ScreenSection);
  };

  const idPrefix = `node-kind-${kind.id}`;
  const tabs: CardTabDef[] = [
    {
      id: 'form',
      label: ui.automation.entry.formTab,
      icon: <FilePenLine className="size-3.5" strokeWidth={1.75} />,
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
    <TypeCardFrame
      quiet={<FormSaveState state={form.state} onRetry={form.retry} />}
      settingsAction={
        <FrameSettingsButton
          label={ui.automation.menuSettingsType}
          onClick={() => openSettings({ kind: 'node-kind', id: kind.id })}
        />
      }
      tabs={tabs}
      activeTab={section}
      onActivateTab={activate}
      idPrefix={idPrefix}
      tabsLabel={ui.nodeKinds.title}
    >
      {section === 'form' ? (
        <TypeCardPanel idPrefix={idPrefix} tab="form">
          <NodeKindFormTab
            kind={kind}
            canSetup={canSetup}
            canCreateField={canCreateField}
            renderCreateField={renderCreateField}
            form={form}
          />
        </TypeCardPanel>
      ) : null}

      {section === 'works' ? (
        <TypeCardPanel idPrefix={idPrefix} tab="works">
          <NodeKindWorksSection
            kind={kind}
            canManage={canManageWorkflows}
            renderProcessTypeCreate={renderProcessTypeCreate}
          />
        </TypeCardPanel>
      ) : null}

      {section === 'usage' ? (
        <TypeCardPanel idPrefix={idPrefix} tab="usage">
          <NodeKindUsageSection kind={kind} renderProjectTypeCreate={renderProjectTypeCreate} />
        </TypeCardPanel>
      ) : null}
    </TypeCardFrame>
  );
}
