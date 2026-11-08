import {
  AlignLeft,
  Banknote,
  Barcode,
  Building2,
  Calendar,
  CalendarClock,
  Folder,
  FolderKanban,
  Hash,
  Link2,
  List,
  ListChecks,
  ListTodo,
  Mail,
  Network,
  SquareCheck,
  Timer,
  Type,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { CustomFieldType } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

/** Значок типа поля — плитка строки реестра, шапка редактора, превью.
 *  Иконка = тип (данные), не декор: цвета — только токены темы. */
const TYPE_ICONS: Record<CustomFieldType, LucideIcon> = {
  text: Type,
  long_text: AlignLeft,
  number: Hash,
  money: Banknote,
  date: Calendar,
  datetime: CalendarClock,
  duration: Timer,
  bool: SquareCheck,
  enum: List,
  multienum: ListChecks,
  user: User,
  users: Users,
  department: Network,
  project: FolderKanban,
  counterparty: Building2,
  task: ListTodo,
  letter: Mail,
  node: Folder,
  link: Link2,
  counter: Barcode,
};

export function fieldTypeIcon(type: CustomFieldType): LucideIcon {
  return TYPE_ICONS[type];
}

export function CustomFieldTypeIcon({
  type,
  className,
}: {
  type: CustomFieldType;
  className?: string;
}) {
  const Icon = TYPE_ICONS[type];
  return <Icon className={cn('size-4', className)} strokeWidth={1.75} aria-hidden />;
}
