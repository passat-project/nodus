import { useState } from 'react';
import type { ProcessTypeIcon, ProjectColor } from '@nodus/contracts';
import { processTypeIconSchema, projectColorSchema, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { cn } from '@nodus/ui/lib/utils';

import { identityTone } from '../../../shared/ui/identity-tone.js';
import { useProjectTypes } from '../../../shared/api/projects-list.js';
import { ProcessTypeGlyph } from '../../../shared/workflow/process-type-icon.js';
import { useCreateProjectType } from '../api/project-catalog-mutations.js';

/**
 * Окно создания типа проекта (#556) — грамматика создания типа процесса:
 * название, значок закрытым набором, цвет-идентичность. Тип сразу получает
 * все виды справочника (`kindIds: null`) — сужение делается в «Настройках
 * типа». Мимо-клик окно не закрывает (правило 30.09: вводимое жалко).
 */
export function ProjectTypeCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Созданный тип становится выбранным в левой колонке. */
  onCreated: (id: string) => void;
}) {
  const create = useCreateProjectType();
  const { data: types } = useProjectTypes(true);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<ProcessTypeIcon>('file-text');
  const [color, setColor] = useState<ProjectColor>('blue');

  const trimmed = name.trim();
  const taken = (types ?? []).some((type) => type.name.toLowerCase() === trimmed.toLowerCase());

  const submit = () => {
    if (!trimmed || taken || create.isPending) return;
    create.mutate(
      { name: trimmed, icon, color },
      {
        onSuccess: (type) => {
          onCreated(type.id);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{ui.projects.typesCreateTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">{ui.projects.fieldName}</span>
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={ui.projects.typesNamePlaceholder}
              aria-invalid={taken || undefined}
              onKeyDown={(event) => event.key === 'Enter' && submit()}
            />
            {taken ? (
              <span className="text-xs text-danger">{ui.projects.typesNameTaken}</span>
            ) : null}
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">{ui.nodeKinds.panel.icon}</span>
            <div className="grid grid-cols-8 gap-1.5">
              {processTypeIconSchema.options.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={icon === key}
                  aria-label={key}
                  onClick={() => setIcon(key)}
                  className={cn(
                    'flex aspect-square min-w-0 items-center justify-center rounded-lg border transition-colors',
                    icon === key
                      ? 'border-ring bg-accent text-foreground'
                      : 'border-border text-muted-foreground hover:border-input',
                  )}
                >
                  <ProcessTypeGlyph icon={key} className="size-4" />
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">{ui.nodeKinds.panel.color}</span>
            <div className="flex gap-2">
              {projectColorSchema.options.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  aria-pressed={color === tone}
                  aria-label={ui.structure.colorNames[tone]}
                  title={ui.structure.colorNames[tone]}
                  onClick={() => setColor(tone)}
                  className={cn(
                    'size-6 rounded-full border-2 transition-colors',
                    identityTone[tone].dot,
                    color === tone ? 'border-foreground' : 'border-transparent',
                  )}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button disabled={!trimmed || taken || create.isPending} onClick={submit}>
            {ui.common.create}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
