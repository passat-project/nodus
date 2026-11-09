import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Trash2 } from 'lucide-react';

import type { BuilderBlockOption, FormBuilderHost } from './builder-host.js';
import type { BlockPatch, BuilderBlock } from './builder-model.js';
import { LayoutInputs } from './builder-field-settings.js';

const b = ui.forms.builder;

/**
 * Настройки блока окна (#496): те же «Подпись в окне» и «Подсказка», что у
 * поля, плюс параметры блока от хоста (режим трудозатрат, обязательность,
 * минимум файлов) — одним списком, без отдельного старого редактора.
 */
export function BuilderBlockSettings<X>({
  block,
  info,
  host,
  readOnly,
  onPatch,
  onRemove,
}: {
  block: BuilderBlock<X>;
  info: BuilderBlockOption | undefined;
  host: FormBuilderHost<X>;
  readOnly: boolean;
  onPatch: (patch: BlockPatch<X>) => void;
  onRemove: () => void;
}) {
  const layout = info?.layout !== false;
  return (
    <div className="flex flex-col gap-3">
      {layout ? (
        <LayoutInputs
          label={block.label}
          hint={block.hint}
          defaultLabel={info?.label ?? block.block}
          readOnly={readOnly}
          onChange={onPatch}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{info?.label ?? block.block}</p>
      )}
      {host.blockSettings?.(block, onPatch)}
      {readOnly ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start text-danger hover:text-danger"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
          {b.remove}
        </Button>
      )}
    </div>
  );
}
