import type { NodeKind, NodeKindCapability } from '@nodus/contracts';
import { NODE_KIND_CAPABILITIES, normalizeNodeKindCapabilities, ui } from '@nodus/contracts';

import { SwitchRow } from '../../../../shared/ui/panel/panel-kit.js';

/**
 * Раздел «Возможности» вида папки (#556, §4c): закрытый список из трёх
 * переключателей. Здесь только хранение и выдача в API — поведение
 * включают потребители (#557 «Документ с изменениями», #469 пульс,
 * #38 схема). Порядок — порядок enum контракта.
 */
export function NodeKindCapabilitiesSection({
  kind,
  canSetup,
  onToggle,
}: {
  kind: NodeKind;
  canSetup: boolean;
  onToggle: (capabilities: NodeKindCapability[]) => void;
}) {
  const enabled = new Set(kind.capabilities);

  function toggle(capability: NodeKindCapability, checked: boolean) {
    const next = checked
      ? [...kind.capabilities, capability]
      : kind.capabilities.filter((entry) => entry !== capability);
    onToggle(normalizeNodeKindCapabilities(next));
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {NODE_KIND_CAPABILITIES.map((capability) => (
        <SwitchRow
          key={capability}
          title={ui.nodeKinds.capabilities[capability].title}
          hint={ui.nodeKinds.capabilities[capability].hint}
          checked={enabled.has(capability)}
          disabled={!canSetup}
          onChange={(checked) => toggle(capability, checked)}
        />
      ))}
    </div>
  );
}
