import type { NodeKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { NodeKindGlyph } from '../lib/node-kind-icon.js';

const SETUP_VALUE = '__setup';

/** Селект вида папки в окне создания (#556): вид — ПЕРВЫМ полем; значок +
 *  имя, внизу списка — «Настроить виды папок» (право `project.setup.manage`). */
export function NodeKindSelect({
  kinds,
  value,
  canSetup,
  onChange,
  onSetup,
}: {
  kinds: NodeKind[];
  value: string;
  canSetup: boolean;
  onChange: (id: string) => void;
  onSetup: () => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => (next === SETUP_VALUE ? onSetup() : onChange(next))}
    >
      <SelectTrigger aria-label={ui.structure.nodeKind} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {kinds.map((kind) => (
          <SelectItem key={kind.id} value={kind.id}>
            <NodeKindGlyph icon={kind.icon} className="size-3.5 shrink-0" />
            {kind.name}
          </SelectItem>
        ))}
        {canSetup ? (
          <>
            <SelectSeparator />
            <SelectItem value={SETUP_VALUE}>{ui.structure.configureKinds}</SelectItem>
          </>
        ) : null}
      </SelectContent>
    </Select>
  );
}
