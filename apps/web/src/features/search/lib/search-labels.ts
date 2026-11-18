import { FolderOpen, ListTodo, Mail, MessageSquare, Users, type LucideIcon } from 'lucide-react';
import type { SearchSourceType } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

/** Порядок типов в панели фильтров поиска. */
export const SEARCH_TYPE_ORDER: readonly SearchSourceType[] = [
  'task',
  'letter',
  'message',
  'project',
  'employee',
];

const ICONS: Record<SearchSourceType, LucideIcon> = {
  task: ListTodo,
  letter: Mail,
  message: MessageSquare,
  project: FolderOpen,
  employee: Users,
};

export function searchTypeIcon(type: SearchSourceType): LucideIcon {
  return ICONS[type];
}

export function searchTypeLabel(type: SearchSourceType): string {
  return ui.search.types[type];
}
