import { useState } from 'react';
import type { ProjectVisibility } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Skeleton } from '@nodus/ui/components/skeleton';

import { usePortalSettings } from '../../../shared/api/projects-list.js';
import { SEGMENTED_ACTIVE_TONAL, SegmentedControl } from '../../../shared/ui/segmented-control.js';
import { useUpdatePortalSettings } from '../api/project-catalog-mutations.js';

/**
 * Окно «Настройки портала» (Р7 #52): слева модули (пока «Проекты»), справа
 * настройки выбранного модуля — видимость новых проектов. Полный дом общих
 * настроек — #276; сюда добавляются его разделы, второй вход не заводится.
 */
export function PortalSettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = usePortalSettings();
  const update = useUpdatePortalSettings();
  const [visibility, setVisibility] = useState<ProjectVisibility | null>(null);
  const saved = settings.data?.projects.defaultVisibility;
  const effective = visibility ?? saved ?? 'open';
  const dirty = visibility !== null && visibility !== saved;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl gap-0 overflow-hidden p-0 sm:max-w-2xl"
        aria-describedby={undefined}
        showCloseButton={false}
      >
        <DialogTitle className="px-5 pt-4 text-base font-semibold">
          {ui.projects.settingsTitle}
        </DialogTitle>
        <div className="grid min-h-48 grid-cols-[10rem_1fr]">
          <nav className="border-r border-border p-2">
            <button
              type="button"
              aria-current
              className="flex h-8 w-full items-center rounded-lg bg-accent px-2.5 text-left text-sm font-medium"
            >
              {ui.projects.settingsProjects}
            </button>
          </nav>
          <div className="flex flex-col gap-3 p-5">
            <NodeLabel label={ui.projects.settingsProjects} />
            {settings.isLoading ? (
              <Skeleton className="h-8 w-56" />
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">
                    {ui.projects.settingsDefaultVisibility}
                  </span>
                  <SegmentedControl
                    ariaLabel={ui.projects.settingsDefaultVisibility}
                    value={effective}
                    options={[
                      { value: 'open', label: ui.projects.visibility.open },
                      { value: 'secret', label: ui.projects.visibility.secret },
                    ]}
                    onChange={setVisibility}
                    activeClassName={SEGMENTED_ACTIVE_TONAL}
                    className="max-w-64"
                  />
                  <span className="text-xs text-muted-foreground">
                    {ui.projects.settingsDefaultVisibilityHint}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="self-start"
                  disabled={!dirty || update.isPending}
                  onClick={() => {
                    if (!dirty) return;
                    update.mutate(
                      { projects: { defaultVisibility: effective } },
                      { onSuccess: () => setVisibility(null) },
                    );
                  }}
                >
                  {ui.common.save}
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="flex h-12 items-center justify-end px-5">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            {ui.common.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
