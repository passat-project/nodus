import type { NodeKind } from '@nodus/contracts';
import { projectColorSchema, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@nodus/ui/components/dialog';
import { cn } from '@nodus/ui/lib/utils';
import { Archive, Palette, RotateCcw, Shapes, Type as TypeIcon } from 'lucide-react';

import { identityTone } from '../../../../shared/ui/identity-tone.js';
import { IconPickGrid } from '../../../../shared/ui/icon-pick-grid.js';
import { NODE_KIND_ICON_KEYS, NodeKindGlyph } from '../../../../shared/ui/node-kind-icon.js';
import { CommitInput } from '../../../../shared/ui/panel/commit-field.js';
import { PanelDanger } from '../../../../shared/ui/panel/panel-kit.js';
import { SettingRow } from '../../../../shared/ui/setting-row.js';
import { useArchiveNodeKind, useUpdateNodeKind } from '../api/node-kinds-api.js';
import { NodeKindCapabilitiesSection } from './node-kind-capabilities-section.js';

/**
 * Окно настроек типа папки (#857, ревизия вкладок 26.11.2026): имя, значок,
 * цвет, возможности и архив — в компактном центрированном окне в стиле окна
 * настройки атрибута. Сама вкладка «Поля и форма» остаётся конструктором
 * формы, поэтому идентичность типа в ней больше не дублируется.
 */
export function NodeKindSettingsDialog({
  kind,
  canSetup,
  onClose,
}: {
  kind: NodeKind;
  canSetup: boolean;
  onClose: () => void;
}) {
  const update = useUpdateNodeKind();
  const archive = useArchiveNodeKind();
  const archived = kind.archivedAt !== null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[92vh] max-w-[52rem] flex-col gap-5 overflow-hidden p-5 sm:max-w-[52rem]"
        showCloseButton
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{ui.nodeKinds.panel.settingsTitle}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1">
            <SettingRow icon={TypeIcon} label={ui.nodeKinds.panel.name}>
              <CommitInput
                value={kind.name}
                required
                disabled={!canSetup}
                onCommit={(name) => update.mutate({ id: kind.id, name })}
                className="h-9 max-w-md text-sm"
              />
            </SettingRow>

            <SettingRow icon={Shapes} label={ui.nodeKinds.panel.icon}>
              <IconPickGrid
                value={kind.icon}
                disabled={!canSetup}
                onSelect={(icon) => update.mutate({ id: kind.id, icon })}
                options={NODE_KIND_ICON_KEYS.map((icon) => ({
                  value: icon,
                  label: ui.structure.iconNames[icon],
                  title: ui.structure.iconNames[icon],
                  glyph: <NodeKindGlyph icon={icon} className="size-4" />,
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
            </SettingRow>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <NodeKindCapabilitiesSection
              kind={kind}
              canSetup={canSetup}
              onToggle={(capabilities) => update.mutate({ id: kind.id, capabilities })}
            />
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
            {canSetup ? (
              archived ? (
                <PanelDanger
                  icon={RotateCcw}
                  onClick={() => archive.mutate({ id: kind.id, archived: false })}
                >
                  {ui.nodeKinds.panel.restore}
                </PanelDanger>
              ) : (
                <PanelDanger
                  icon={Archive}
                  onClick={() =>
                    archive.mutate(
                      { id: kind.id, archived: true },
                      // Архивация закрывает окно; экран типа остаётся — у
                      // архивного внизу «Вернуть» (резолвер его открывает).
                      { onSuccess: onClose },
                    )
                  }
                >
                  {ui.nodeKinds.panel.archive}
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
