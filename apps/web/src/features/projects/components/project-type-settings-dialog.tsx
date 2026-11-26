import { useMemo } from 'react';
import { Archive, Palette, RotateCcw, Shapes, Type as TypeIcon } from 'lucide-react';
import type { ProjectType } from '@nodus/contracts';
import {
  isFormDecor,
  processTypeIconSchema,
  projectColorSchema,
  projectTypeFormOf,
  ui,
  withProjectSystemElements,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@nodus/ui/components/dialog';
import { cn } from '@nodus/ui/lib/utils';

import { identityTone } from '../../../shared/ui/identity-tone.js';
import { IconPickGrid } from '../../../shared/ui/icon-pick-grid.js';
import { CommitInput } from '../../../shared/ui/panel/commit-field.js';
import { PanelDanger, SectionLink } from '../../../shared/ui/panel/panel-kit.js';
import { SettingRow } from '../../../shared/ui/setting-row.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import {
  useSetProjectTypeArchived,
  useUpdateProjectType,
} from '../api/project-catalog-mutations.js';

/**
 * Окно настроек типа проекта (#857, ревизия вкладок 26.11.2026): имя, значок,
 * цвет, окно создания и архив живут в компактном центрированном окне в стиле
 * окна настройки атрибута — вкладка «Настройки» убрана. Открывается из
 * «⋯ → Настройки типа…» строки колонки и шестерёнкой в полосе вкладок.
 */
export function ProjectTypeSettingsDialog({
  type,
  canSetup,
  onEditWindow,
  onClose,
}: {
  type: ProjectType;
  canSetup: boolean;
  onEditWindow: () => void;
  onClose: () => void;
}) {
  const update = useUpdateProjectType();
  const archive = useSetProjectTypeArchived();
  const form = useMemo(() => withProjectSystemElements(projectTypeFormOf(type)), [type]);
  const fields = useMemo(
    () => form.fields.filter((element) => !isFormDecor(element)).length,
    [form],
  );
  const archived = type.archivedAt !== null;
  const patch = (body: {
    name?: string;
    icon?: ProjectType['icon'];
    color?: ProjectType['color'];
  }) => update.mutate({ id: type.id, ...body });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[92vh] max-w-[52rem] flex-col gap-5 overflow-hidden p-5 sm:max-w-[52rem]"
        showCloseButton
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{ui.projects.schemasTabSettings}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1">
            <SettingRow icon={TypeIcon} label={ui.projects.fieldName}>
              <CommitInput
                value={type.name}
                required
                disabled={!canSetup}
                onCommit={(name) => patch({ name })}
                className="h-9 max-w-md text-sm"
              />
            </SettingRow>

            <SettingRow icon={Shapes} label={ui.nodeKinds.panel.icon}>
              <IconPickGrid
                value={type.icon}
                disabled={!canSetup}
                onSelect={(icon) => patch({ icon })}
                options={processTypeIconSchema.options.map((icon) => ({
                  value: icon,
                  label: icon,
                  glyph: <ProcessTypeGlyph icon={icon} className="size-4" />,
                }))}
              />
            </SettingRow>

            <SettingRow icon={Palette} label={ui.nodeKinds.panel.color}>
              <div className="flex flex-wrap items-center gap-2 py-2">
                {projectColorSchema.options.map((color) => (
                  <button
                    key={color}
                    type="button"
                    disabled={!canSetup}
                    onClick={() => patch({ color })}
                    aria-label={ui.structure.colorNames[color]}
                    title={ui.structure.colorNames[color]}
                    aria-pressed={type.color === color}
                    className={cn(
                      'size-6 rounded-full border-2 transition-colors disabled:cursor-default',
                      identityTone[color].dot,
                      type.color === color ? 'border-foreground' : 'border-transparent',
                    )}
                  />
                ))}
              </div>
            </SettingRow>
          </div>

          <div className="mt-3 flex max-w-2xl flex-col gap-0.5">
            <SectionLink
              title={ui.projects.schemasWindowPanel}
              summary={
                canSetup
                  ? `${ui.forms.builder.edit} · ${ui.forms.builder.summary(fields, 0)}`
                  : ui.forms.builder.summary(fields, 0)
              }
              onClick={onEditWindow}
            />
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
            {canSetup ? (
              archived ? (
                <PanelDanger
                  icon={RotateCcw}
                  onClick={() => archive.mutate({ id: type.id, archived: false })}
                >
                  {ui.projects.typesRestore}
                </PanelDanger>
              ) : (
                <PanelDanger
                  icon={Archive}
                  onClick={() =>
                    archive.mutate(
                      { id: type.id, archived: true },
                      // Архивация закрывает окно: ptype больше не резолвится,
                      // выбор сбрасывается на умолчание.
                      { onSuccess: onClose },
                    )
                  }
                >
                  {ui.projects.typesArchive}
                </PanelDanger>
              )
            ) : (
              <span />
            )}
            <Button variant="ghost" onClick={onClose}>
              {ui.common.close}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
