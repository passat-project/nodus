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
import type { NodeKindIcon } from '@nodus/contracts';

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

/** Ключи реестра для селектов (иконка вида в окнах структуры/справочника). */
export const NODE_KIND_ICON_KEYS = Object.keys(ICONS) as NodeKindIcon[];
