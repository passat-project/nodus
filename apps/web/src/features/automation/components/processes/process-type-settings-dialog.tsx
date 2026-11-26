import { useMemo } from 'react';
import type { ProcessType, StageColor, UpdateProcessTypeBody } from '@nodus/contracts';
import { processTypeIconSchema, typeConfigOf, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@nodus/ui/components/dialog';
import { Switch } from '@nodus/ui/components/switch';
import { cn } from '@nodus/ui/lib/utils';
import { Palette, Settings2, Trash2, Type as TypeIcon } from 'lucide-react';

import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useUpdateTypeCreation } from '../../../../shared/api/process-types-api.js';
import { stageColorOrder, stageTone } from '../../../../shared/ui/board/stage-tone.js';
import { IconPickGrid } from '../../../../shared/ui/icon-pick-grid.js';
import { CommitInput, CommitTextarea } from '../../../../shared/ui/panel/commit-field.js';
import { PanelDanger, PanelField, PanelNote } from '../../../../shared/ui/panel/panel-kit.js';
import { SettingRow } from '../../../../shared/ui/setting-row.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';
import { useArchiveProcessType, useUpdateProcessType } from '../../api/automation-api.js';
import { numberingSummary } from '../../lib/type-settings-summary.js';
import { TypeAccessSection } from '../editor/panel/type-settings-access.js';
import { TypeBlocksSection, TypeRoleLabelsSection } from '../editor/panel/type-settings-card.js';

/**
 * Окно настроек типа процесса (#857, ревизия вкладок 26.11.2026): «мелочь»
 * больше не занимает вкладку на весь экран — имя, значок, цвет, описание,
 * «где создаётся» (без проекта, вид папки), доступ, блоки карточки, роли,
 * нумерация и архив живут в аккуратном центрированном окне в стиле окна
 * настройки атрибута (FieldDialog). Открывается из «⋯ → Настройки типа…»
 * строки колонки и из кнопки шестерёнки в правом углу полосы вкладок.
 * У письма (каталог системный, #55) всё — только чтение.
 */
export function ProcessTypeSettingsDialog({
  type,
  onClose,
}: {
  type: ProcessType;
  onClose: () => void;
}) {
  const update = useUpdateProcessType();
  const archive = useArchiveProcessType(true);
  const updateScope = useUpdateTypeCreation();
  const { data: kinds } = useNodeKinds();
  const task = type.category === 'task';
  const locked = !task;
  const scope = typeConfigOf(type).creation;
  const patch = (body: UpdateProcessTypeBody) => update.mutate({ id: type.id, body });
  const liveKinds = useMemo(
    () => (kinds ?? []).filter((kind) => kind.archivedAt === null),
    [kinds],
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[92vh] max-w-[52rem] flex-col gap-5 overflow-hidden p-5 sm:max-w-[52rem]"
        showCloseButton
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{ui.automation.typeSettings.title}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1">
            <SettingRow icon={TypeIcon} label={ui.automation.fieldName}>
              <CommitInput
                value={type.name}
                required
                maxLength={60}
                readOnly={locked}
                aria-label={ui.automation.fieldName}
                className="h-9 max-w-md text-sm"
                onCommit={(name) => patch({ name })}
              />
            </SettingRow>

            <SettingRow icon={Settings2} label={ui.automation.fieldIcon}>
              <IconPickGrid
                value={type.icon}
                disabled={locked}
                onSelect={(icon) => type.icon !== icon && patch({ icon })}
                options={processTypeIconSchema.options.map((icon) => ({
                  value: icon,
                  label: icon,
                  glyph: <ProcessTypeGlyph icon={icon} className="size-4" />,
                }))}
              />
            </SettingRow>

            <SettingRow icon={Palette} label={ui.automation.fieldColor}>
              <div className="flex flex-wrap items-center gap-2 py-2">
                {stageColorOrder.map((tone: StageColor) => (
                  <button
                    key={tone}
                    type="button"
                    aria-pressed={type.color === tone}
                    aria-label={ui.tasks.stageColors[tone]}
                    title={ui.tasks.stageColors[tone]}
                    disabled={locked}
                    onClick={() => type.color !== tone && patch({ color: tone })}
                    className={cn(
                      'size-6 rounded-full border-2 transition-colors disabled:cursor-default',
                      stageTone[tone].swatch,
                      type.color === tone ? 'border-foreground' : 'border-transparent',
                    )}
                  />
                ))}
              </div>
            </SettingRow>

            <SettingRow icon={TypeIcon} label={ui.automation.fieldDescription}>
              <CommitTextarea
                value={type.description}
                rows={3}
                maxLength={500}
                readOnly={locked}
                aria-label={ui.automation.fieldDescription}
                className="max-w-xl resize-none text-sm"
                onCommit={(description) => patch({ description })}
              />
            </SettingRow>
          </div>

          {task ? (
            <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4">
              <span className="text-label uppercase text-muted-foreground">
                {ui.automation.creationScope.sectionTitle}
              </span>
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1 text-sm">
                  {ui.automation.creationScope.withoutProject}
                </span>
                <Switch
                  checked={scope.withoutProject}
                  disabled={updateScope.isPending}
                  aria-label={ui.automation.creationScope.withoutProject}
                  onCheckedChange={(checked) =>
                    updateScope.mutate({
                      typeId: type.id,
                      creation: { ...scope, withoutProject: checked },
                    })
                  }
                />
              </div>
              <PanelField label={ui.automation.creationScope.folderKind}>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      updateScope.mutate({
                        typeId: type.id,
                        creation: { ...scope, folderKindId: null },
                      })
                    }
                    aria-pressed={scope.folderKindId === null}
                    className={cn(
                      'h-8 rounded-lg border px-2 text-left text-sm transition-colors',
                      scope.folderKindId === null
                        ? 'border-ring bg-accent'
                        : 'border-border hover:bg-accent/50',
                    )}
                  >
                    {ui.automation.creationScope.folderKindAny}
                  </button>
                  {liveKinds.map((kind) => (
                    <button
                      key={kind.id}
                      type="button"
                      onClick={() =>
                        updateScope.mutate({
                          typeId: type.id,
                          creation: { ...scope, folderKindId: kind.id },
                        })
                      }
                      aria-pressed={scope.folderKindId === kind.id}
                      className={cn(
                        'h-8 truncate rounded-lg border px-2 text-left text-sm transition-colors',
                        scope.folderKindId === kind.id
                          ? 'border-ring bg-accent'
                          : 'border-border hover:bg-accent/50',
                      )}
                    >
                      {kind.name}
                    </button>
                  ))}
                </div>
              </PanelField>
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4">
            <span className="text-label uppercase text-muted-foreground">
              {ui.automation.typeSettings.sections.access}
            </span>
            <TypeAccessSection type={type} readOnly={locked} />
          </div>

          {task ? (
            <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4">
              <span className="text-label uppercase text-muted-foreground">
                {ui.automation.typeSettings.sections.blocks}
              </span>
              <TypeBlocksSection type={type} readOnly={locked} />
            </div>
          ) : null}

          {task ? (
            <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4">
              <span className="text-label uppercase text-muted-foreground">
                {ui.automation.typeSettings.sections.roles}
              </span>
              <TypeRoleLabelsSection type={type} readOnly={locked} />
            </div>
          ) : null}

          {!task ? (
            <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4">
              <span className="text-label uppercase text-muted-foreground">
                {ui.automation.typeSettings.sections.numbering}
              </span>
              <PanelField label={ui.automation.typeSettings.numbering.format}>
                <p className="font-mono text-sm text-secondary-foreground tabular-nums">
                  {numberingSummary(type)}
                </p>
              </PanelField>
              <PanelNote>{ui.automation.typeSettings.numbering.readOnly}</PanelNote>
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
            {/* Архивация закрывает окно: строка уходит из живых, выбор
                сбрасывается на умолчание резолвером (архived id не ищется). */}
            <PanelDanger
              icon={Trash2}
              onClick={() => archive.mutate(type.id, { onSuccess: onClose })}
            >
              {ui.automation.menuArchive}
            </PanelDanger>
            <Button variant="ghost" onClick={onClose}>
              {ui.common.close}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
