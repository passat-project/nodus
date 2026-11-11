import { Eye } from 'lucide-react';
import type { UserRef } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import {
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@nodus/ui/components/context-menu';

import { shortPersonName } from '../lib/format.js';
import { PersonAvatar } from '../ui/person-avatar.js';

/** Список посмотревших в подменю «Кто просмотрел»: та же композиция строк,
 *  что в попапе pill'а просмотров (views-line) — аватар + ФИО, скролл для
 *  длинных списков. Часть слоя меню: не воюет с «вечным курсором». */
export function ViewersSubmenu({ viewers }: { viewers: readonly UserRef[] }) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Eye className="size-4" strokeWidth={1.75} />
        {ui.chat.whoViewed}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-max min-w-44 p-1">
        <div data-slot="views-submenu-list" className="max-h-56 overflow-y-auto px-0.5">
          {viewers.map((viewer) => (
            <span key={viewer.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
              <PersonAvatar
                name={viewer.displayName}
                avatarUrl={viewer.avatarUrl}
                decorative
                className="size-6 shrink-0"
              />
              <span className="min-w-0 truncate text-sm">
                {shortPersonName(viewer.displayName)}
              </span>
            </span>
          ))}
        </div>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
