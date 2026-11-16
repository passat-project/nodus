import { LayoutGrid, type LucideIcon } from 'lucide-react';
import { ui } from '@nodus/contracts';

import { RAIL_MODULES } from '../../../app/shell/nav-registry.js';
import {
  CHANGE_TYPE_ORDER,
  GENERAL_MODULE,
  type Release,
  type ReleaseItem,
} from './release-schema.js';

export interface ReleaseModule {
  id: string;
  label: string;
  icon: LucideIcon;
}

export interface ModuleGroup {
  module: ReleaseModule;
  items: ReleaseItem[];
}

const GENERAL: ReleaseModule = {
  id: GENERAL_MODULE,
  label: ui.whatsNew.moduleGeneral,
  icon: LayoutGrid,
};

/** Модули заметок — ЕДИНЫЙ реестр навигации (иконка и название как в
 *  левой рейке) + «Общее» последним. Порядок — системный порядок рейки. */
export const RELEASE_MODULES: readonly ReleaseModule[] = [
  ...RAIL_MODULES.map(({ id, label, icon }) => ({ id, label, icon })),
  GENERAL,
];

const MODULE_INDEX = new Map(RELEASE_MODULES.map((m, i) => [m.id, i]));

/** Неизвестный id (опечатка в данных) → «Общее»: пункт не теряется. */
export function resolveModule(id: string): ReleaseModule {
  const index = MODULE_INDEX.get(id);
  return index === undefined ? GENERAL : (RELEASE_MODULES[index] ?? GENERAL);
}

/** Пункты выпуска по модулям в порядке рейки; внутри модуля — новое →
 *  улучшено → исправлено (порядок файла внутри типа сохраняется).
 *  `moduleId` — фильтр панели (null = все модули). */
export function groupByModule(
  items: readonly ReleaseItem[],
  moduleId: string | null,
): ModuleGroup[] {
  const groups = new Map<string, ModuleGroup>();
  for (const item of items) {
    const module = resolveModule(item.module);
    if (moduleId !== null && module.id !== moduleId) continue;
    const group = groups.get(module.id) ?? { module, items: [] };
    group.items.push(item);
    groups.set(module.id, group);
  }
  const typeRank = (item: ReleaseItem) => CHANGE_TYPE_ORDER.indexOf(item.type);
  return [...groups.values()]
    .sort((a, b) => (MODULE_INDEX.get(a.module.id) ?? 0) - (MODULE_INDEX.get(b.module.id) ?? 0))
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => typeRank(a) - typeRank(b)),
    }));
}

/** Модули, в которых были изменения хотя бы в одном выпуске (чипы фильтра). */
export function modulesWithChanges(releases: readonly Release[]): ReleaseModule[] {
  const ids = new Set(releases.flatMap((r) => r.items.map((i) => resolveModule(i.module).id)));
  return RELEASE_MODULES.filter((m) => ids.has(m.id));
}
