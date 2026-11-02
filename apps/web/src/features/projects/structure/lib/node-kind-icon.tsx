import {
  Box,
  Boxes,
  Building,
  Building2,
  Factory,
  FileText,
  Flag,
  Folder,
  FolderTree,
  Landmark,
  Layers,
  ListTree,
  Milestone,
  Route,
  SquareStack,
  type LucideIcon,
} from 'lucide-react';
import type { NodeKind, NodeKindIcon } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { identityTone } from '../../../../shared/ui/identity-tone.js';

/** Реестр значков видов уровней (#467): закрытый набор ключей lucide из
 *  контракта `nodeKindIconSchema`; новая иконка = расширение набора там и
 *  здесь (рассинхрон — ошибка типов). Паттерн process-type-icon.tsx. */
const ICONS: Record<NodeKindIcon, LucideIcon> = {
  folder: Folder,
  folderTree: FolderTree,
  layers: Layers,
  building: Building,
  building2: Building2,
  landmark: Landmark,
  boxes: Boxes,
  box: Box,
  listTree: ListTree,
  flag: Flag,
  milestone: Milestone,
  factory: Factory,
  route: Route,
  squareStack: SquareStack,
  fileText: FileText,
};

export function NodeKindGlyph({ icon, className }: { icon: NodeKindIcon; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}

/** Плитка вида папки — значок в цвете-идентичности на пастельном квадрате
 *  (та же грамматика, что у маркеров проектов): строка списка видов, шапки
 *  панелей, списки выбора. Одна плитка на все места — вид узнаётся по цвету
 *  и значку, а не по серой иконке (#556). */
export function NodeKindTile({
  icon,
  color,
  className,
}: {
  icon: NodeKindIcon;
  color: NodeKind['color'];
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded border',
        identityTone[color].tile,
        className,
      )}
    >
      <NodeKindGlyph icon={icon} className="size-3.5" />
    </span>
  );
}

/** Ключи реестра для селектов (иконка вида в окнах структуры/справочника). */
export const NODE_KIND_ICON_KEYS = Object.keys(ICONS) as NodeKindIcon[];
