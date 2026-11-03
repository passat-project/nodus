import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ui, type StageColor } from '@nodus/contracts';
import { processTypeIconSchema, type ProcessTypeIcon } from '@nodus/contracts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@nodus/ui/components/dialog';
import { Button } from '@nodus/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Input } from '@nodus/ui/components/input';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import { useCreateProcessType, useProcessTypes } from '../../api/automation-api.js';
import { useCanManageWorkflows } from '../../lib/use-can-manage-workflows.js';
import { stageColorOrder, stageTone } from '../../../../shared/ui/board/stage-tone.js';
import { ProcessTypeGlyph } from '../../../../shared/workflow/process-type-icon.js';

const ICONS = processTypeIconSchema.options;

/**
 * Диалог создания типа процесса: название, значок (закрытый набор), цвет
 * (5 тонов), основа маршрута — копия типа той же категории или «Простой».
 * Созданный тип скрыт и выбран. Категория здесь — задача (письма — #55).
 */
export function ProcessTypeCreateDialog({
  onClose,
  defaultBaseTypeId,
}: {
  onClose: () => void;
  /** Основа по умолчанию («Копировать тип» из шапки). */
  defaultBaseTypeId?: string;
}) {
  const canManage = useCanManageWorkflows();
  const { data: types } = useProcessTypes();
  const create = useCreateProcessType();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [icon, setIcon] = useState<ProcessTypeIcon>('square-check');
  const [color, setColor] = useState<StageColor>('neutral');
  const [base, setBase] = useState<{ kind: 'copy'; typeId: string } | { kind: 'simple' }>(
    defaultBaseTypeId ? { kind: 'copy', typeId: defaultBaseTypeId } : { kind: 'simple' },
  );

  const baseTypes = useMemo(() => (types ?? []).filter((t) => !t.archivedAt), [types]);
  const trimmed = name.trim();
  const taken = baseTypes.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  const submit = () => {
    if (!trimmed || taken) return;
    create.mutate(
      {
        name: trimmed,
        // Категория на этом экране одна — задача (письма — #55).
        category: 'task',
        icon,
        color,
        base: base.kind === 'copy' && base.typeId ? base : { kind: 'simple' },
      },
      {
        onSuccess: (type) => {
          toast.success(ui.automation.createdHint);
          void navigate({
            to: '/automation',
            search: (prev) => ({ ...prev, tab: 'processes', type: type.id }),
          });
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Окно пополняется данными: мимо-клик не закрывает (правило 30.09). */}
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{ui.automation.createTitle}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">{ui.automation.fieldName}</span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={ui.automation.fieldNamePlaceholder}
              aria-invalid={taken || undefined}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
            {taken ? <span className="text-xs text-danger">{ui.automation.nameTaken}</span> : null}
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">{ui.automation.fieldIcon}</span>
            <div className="grid grid-cols-8 gap-1.5">
              {ICONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={icon === key}
                  onClick={() => setIcon(key)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg border transition-colors',
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
            <span className="text-label text-muted-foreground">{ui.automation.fieldColor}</span>
            <div className="flex gap-2">
              {stageColorOrder.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  aria-pressed={color === tone}
                  onClick={() => setColor(tone)}
                  className={cn(
                    'size-6 rounded-full border-2 transition-colors',
                    stageTone[tone].swatch,
                    color === tone ? 'border-foreground' : 'border-transparent',
                  )}
                />
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-label text-muted-foreground">{ui.automation.fieldBase}</span>
            <Select
              value={base.kind === 'copy' ? base.typeId : 'simple'}
              onValueChange={(value) =>
                setBase(value === 'simple' ? { kind: 'simple' } : { kind: 'copy', typeId: value })
              }
            >
              <SelectTrigger className="w-full min-w-0" aria-label={ui.automation.fieldBase}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="simple">{ui.automation.baseSimple}</SelectItem>
                {baseTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {ui.automation.baseCopy}: {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button disabled={!trimmed || taken || create.isPending || !canManage} onClick={submit}>
            {ui.automation.createSubmit}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
