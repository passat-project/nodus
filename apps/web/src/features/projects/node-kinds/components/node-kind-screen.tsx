import { useEffect, useState } from 'react';
import { Permission, projectColorSchema, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { NodeChip } from '@nodus/ui/components/node-chip';
import { Skeleton } from '@nodus/ui/components/skeleton';
import { cn } from '@nodus/ui/lib/utils';
import { RotateCcw } from 'lucide-react';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useCanManageWorkflows } from '../../../../shared/api/use-can-manage-workflows.js';
import { useProjectTypes } from '../../../../shared/api/projects-list.js';
import { useAuthStore } from '../../../../shared/auth-store.js';
import { useCanManageFields } from '../../../../shared/custom-fields/use-can-manage-fields.js';
import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { CommitInput } from '../../../../shared/ui/panel/commit-field.js';
import { PanelDanger, PanelField } from '../../../../shared/ui/panel/panel-kit.js';
import {
  NODE_KIND_ICON_KEYS,
  NodeKindGlyph,
  NodeKindTile,
} from '../../../../shared/ui/node-kind-icon.js';
import { useArchiveNodeKind, useUpdateNodeKind } from '../api/node-kinds-api.js';
import type { RenderCreateField } from '../types.js';
import { NodeKindCapabilitiesSection } from './node-kind-capabilities-section.js';
import { NodeKindFormSection } from './node-kind-form-section.js';
import { kindUsageText } from './node-kind-summary.js';
import { NodeKindUsageSection } from './node-kind-usage-section.js';
import { NodeKindWorksSection } from './node-kind-works-section.js';

type ScreenSection = 'form' | 'metrics' | 'actions' | 'works' | 'usage';

const SECTIONS: { id: ScreenSection; label: string }[] = [
  { id: 'form', label: ui.nodeKinds.screen.fieldsForm },
  { id: 'metrics', label: ui.nodeKinds.screen.metrics },
  { id: 'actions', label: ui.nodeKinds.screen.actions },
  { id: 'works', label: ui.nodeKinds.screen.works },
  { id: 'usage', label: ui.nodeKinds.screen.usage },
];

/**
 * Экран типа папки (#857, единая модель §5/§11) — на всю рабочую область
 * вкладки «Процессы» (`?ftype=`), колонка скрыта: шапка с возвратом
 * («‹ Договор», дорожку собирает app-уровень), имя и плитка типа, своя
 * навигация разделов одного уровня — «Поля и форма» · «Показатели» ·
 * «Действия» · «Работы в папке» · «Где используется». «Показатели» и
 * «Действия» — заделы (#865, #633) с понятным пустым состоянием.
 */
export function NodeKindScreen({
  kindId,
  backLabel,
  onBack,
  renderCreateField,
  onOpenProjectType,
}: {
  kindId: string;
  /** Куда ведёт «‹»: имя типа проекта (дорожка) или «Назад». */
  backLabel: string;
  onBack: () => void;
  renderCreateField?: RenderCreateField;
  onOpenProjectType: (id: string) => void;
}) {
  const kindsQuery = useNodeKinds();
  const kinds = kindsQuery.data ?? [];
  const kind = kinds.find((entry) => entry.id === kindId) ?? null;
  const { data: projectTypes } = useProjectTypes();
  const update = useUpdateNodeKind();
  const archive = useArchiveNodeKind();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canSetup = permissions.includes(Permission.PROJECT_SETUP_MANAGE);
  const canManageWorkflows = useCanManageWorkflows();
  const canCreateField = useCanManageFields();

  const [section, setSection] = useState<ScreenSection>('form');
  const [shownId, setShownId] = useState(kindId);
  // Смена типа — с первого раздела (derive-render).
  if (kindId !== shownId) {
    setShownId(kindId);
    setSection('form');
  }

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

  const archived = kind.archivedAt !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 hover:bg-accent"
          onClick={onBack}
          aria-label={backLabel}
          title={backLabel}
        >
          <span aria-hidden className="text-lg leading-none">
            ‹
          </span>
        </Button>
        <NodeKindTile icon={kind.icon} color={kind.color} className="size-6" />
        <span className="min-w-0 truncate text-sm font-medium" title={kind.name}>
          {kind.name}
        </span>
        {archived ? (
          <NodeChip tone="muted" className="shrink-0">
            {ui.projects.schemasKindArchived}
          </NodeChip>
        ) : null}
        {/* Подсказка «Используется: …» (#857, п.1 правил) — сколько живых
            типов проектов разрешают этот тип папки. */}
        {kindUsageText(kind, projectTypes ?? []) ? (
          <span
            className="min-w-0 truncate text-xs text-muted-foreground"
            title={kindUsageText(kind, projectTypes ?? [])}
          >
            {kindUsageText(kind, projectTypes ?? [])}
          </span>
        ) : null}
      </header>

      <nav
        aria-label={ui.nodeKinds.title}
        className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-3"
      >
        {SECTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSection(tab.id)}
            aria-current={section === tab.id || undefined}
            className={cn(
              'rounded-lg px-2.5 py-1 text-sm transition-colors',
              section === tab.id
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-6 py-5">
          {section === 'form' ? (
            <>
              <PanelField label={ui.nodeKinds.panel.name}>
                <CommitInput
                  value={kind.name}
                  required
                  disabled={!canSetup}
                  onCommit={(name) => update.mutate({ id: kind.id, name })}
                  className="h-8 text-sm"
                />
              </PanelField>

              <PanelField label={ui.nodeKinds.panel.icon}>
                <div className="grid grid-cols-8 gap-1">
                  {NODE_KIND_ICON_KEYS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      disabled={!canSetup}
                      onClick={() => update.mutate({ id: kind.id, icon })}
                      aria-label={ui.structure.iconNames[icon]}
                      title={ui.structure.iconNames[icon]}
                      aria-pressed={kind.icon === icon}
                      className={cn(
                        'flex aspect-square min-w-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-default',
                        kind.icon === icon
                          ? 'border-ring bg-accent text-foreground'
                          : 'border-border text-muted-foreground enabled:hover:border-input enabled:hover:text-foreground',
                      )}
                    >
                      <NodeKindGlyph icon={icon} className="size-4" />
                    </button>
                  ))}
                </div>
              </PanelField>

              <PanelField label={ui.nodeKinds.panel.color}>
                <div className="flex flex-wrap gap-2">
                  {projectColorSchema.options.map((color) => (
                    <button
                      key={color}
                      type="button"
                      disabled={!canSetup}
                      onClick={() => update.mutate({ id: kind.id, color })}
                      aria-label={ui.structure.colorNames[color]}
                      title={ui.structure.colorNames[color]}
                      aria-pressed={kind.color === color}
                      className={cn(
                        'size-6 rounded-full border-2 transition-colors disabled:cursor-default',
                        identityTone[color].dot,
                        kind.color === color ? 'border-foreground' : 'border-transparent',
                      )}
                    />
                  ))}
                </div>
              </PanelField>

              <NodeKindFormSection
                kind={kind}
                canSetup={canSetup}
                canCreateField={canCreateField}
                renderCreateField={renderCreateField}
                onSave={(form) => update.mutate({ id: kind.id, form })}
              />

              <NodeKindCapabilitiesSection
                kind={kind}
                canSetup={canSetup}
                onToggle={(capabilities) => update.mutate({ id: kind.id, capabilities })}
              />

              {canSetup ? (
                archived ? (
                  <PanelDanger
                    icon={RotateCcw}
                    onClick={() => archive.mutate({ id: kind.id, archived: false })}
                  >
                    {ui.nodeKinds.panel.restore}
                  </PanelDanger>
                ) : (
                  <PanelDanger onClick={() => archive.mutate({ id: kind.id, archived: true })}>
                    {ui.nodeKinds.panel.archive}
                  </PanelDanger>
                )
              ) : null}
            </>
          ) : null}

          {section === 'metrics' ? (
            <Empty>
              <EmptyTitle>{ui.nodeKinds.screen.metricsEmpty}</EmptyTitle>
            </Empty>
          ) : null}

          {section === 'actions' ? (
            <Empty>
              <EmptyTitle>{ui.nodeKinds.screen.actionsEmpty}</EmptyTitle>
            </Empty>
          ) : null}

          {section === 'works' ? (
            <NodeKindWorksSection kind={kind} canManage={canManageWorkflows} />
          ) : null}

          {section === 'usage' ? (
            <NodeKindUsageSection kind={kind} onOpenProjectType={onOpenProjectType} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
