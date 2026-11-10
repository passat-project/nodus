import {
  MAX_CARD_TAB_GROUPS,
  type DropResolution,
  type ResolveDropInput,
  type RectLike,
} from './card-tabs-types.js';

const within = (rect: RectLike, x: number, y: number): boolean =>
  x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

/**
 * Куда упадёт вкладка: край рабочей зоны → новая область; полоса → вставка
 * по середине вкладок; контент → в конец и активировать; своё место → no-op.
 * Никаких мутаций — только решение, применение отдельно (I5). Край — только
 * КОНТЕНТ, не полоса: иначе перетаскивание в конец полосы создавало бы
 * область. При двух областях край работает как перенос в соседнюю.
 */
export function resolveDrop({
  groups,
  source,
  pointer,
  areas,
  workArea,
  edgeRatio = 0.15,
  maxGroups = MAX_CARD_TAB_GROUPS,
}: ResolveDropInput): DropResolution {
  const overStrip = areas.some((area) => within(area.strip, pointer.x, pointer.y));
  const edge = Math.max(0, Math.min(0.4, edgeRatio));
  const edgeWidth = (workArea.right - workArea.left) * edge;
  const inWorkY = pointer.y >= workArea.top && pointer.y <= workArea.bottom;
  if (!overStrip && inWorkY && groups.length < maxGroups) {
    if (pointer.x <= workArea.left + edgeWidth) {
      return { type: 'split', groupId: source.groupId, tabId: source.tabId, side: 'left' };
    }
    if (pointer.x >= workArea.right - edgeWidth) {
      return { type: 'split', groupId: source.groupId, tabId: source.tabId, side: 'right' };
    }
  }

  // Полоса: вставка по серединам вкладок (layout midpoint, без elementFromPoint).
  for (const area of areas) {
    if (!within(area.strip, pointer.x, pointer.y)) continue;
    let index = area.tabs.length;
    for (let i = 0; i < area.tabs.length; i += 1) {
      const rect = area.tabs[i]!.rect;
      if (pointer.x < (rect.left + rect.right) / 2) {
        index = i;
        break;
      }
    }
    const group = groups.find((entry) => entry.id === area.groupId);
    if (!group) return { type: 'noop' };
    if (area.groupId === source.groupId) {
      const from = group.tabs.indexOf(source.tabId);
      if (from < 0) return { type: 'noop' };
      const adjusted = index > from ? index - 1 : index;
      if (adjusted === from) return { type: 'noop' };
      return { type: 'reorder', groupId: area.groupId, tabId: source.tabId, index };
    }
    return { type: 'move', targetGroupId: area.groupId, tabId: source.tabId, index };
  }

  // Контент области.
  for (const area of areas) {
    if (!within(area.content, pointer.x, pointer.y)) continue;
    if (area.groupId === source.groupId) {
      return { type: 'activate', groupId: area.groupId, tabId: source.tabId };
    }
    return { type: 'move-end', targetGroupId: area.groupId, tabId: source.tabId };
  }

  return { type: 'noop' };
}
