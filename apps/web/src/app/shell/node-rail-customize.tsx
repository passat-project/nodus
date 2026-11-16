import { useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { CIRCUIT_REMEASURE } from './circuit-geometry.js';
import type { NavModuleDef } from './nav-registry.js';
import { HIDDEN_SENTINEL, HiddenSentinelRow, RailPort, SortableRailRow } from './node-rail-rows.js';

/**
 * Режим «Изменить порядок» рейки (концепт #4, вынесен из node-rail.tsx —
 * I5, аудит #45): черновик [видимые…, СЕПАРАТОР «— Скрытое —», скрытые…],
 * dnd с неподвижным сепаратором (модуль за ним = скрыт; минимум один
 * видимый — сепаратор первым стать не может), KeyboardSensor (reorder
 * доступен с клавиатуры). Подтверждение — ИНЛАЙН сразу после списка, на
 * месте ряда «Настройки» (вердикт 15.09.2026: команда и её подтверждение
 * держатся вместе даже при коротком списке, не в подвале рейки).
 */
export function RailCustomizeMode({
  initialDraft,
  badges,
  isActive,
  byId,
  onApply,
  onCancel,
}: {
  initialDraft: string[];
  badges: (m: NavModuleDef) => number | undefined;
  isActive: (m: NavModuleDef) => boolean;
  byId: (id: string) => NavModuleDef | undefined;
  onApply: (order: string[], hidden: string[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const remeasure = () => window.dispatchEvent(new Event(CIRCUIT_REMEASURE));

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || active.id === over.id) return;
    setDraft((d) => {
      const from = d.indexOf(String(active.id));
      const to = d.indexOf(String(over.id));
      if (from < 0 || to < 0 || from === to) return d;
      const next = arrayMove(d, from, to);
      // Минимум один видимый модуль: сепаратор первым стать не может.
      if (next.indexOf(HIDDEN_SENTINEL) === 0) return d;
      return next;
    });
    // Порты следуют за слотами сразу; вспышки нет — фокус не меняется.
    remeasure();
  };

  const apply = () => {
    const sentIdx = draft.indexOf(HIDDEN_SENTINEL);
    onApply(
      draft.filter((id) => id !== HIDDEN_SENTINEL),
      draft.slice(sentIdx + 1),
    );
  };

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragOver={onDragOver}>
        <SortableContext items={draft} strategy={verticalListSortingStrategy}>
          <div className="relative flex flex-col gap-0.5">
            {draft.map((id) => {
              if (id === HIDDEN_SENTINEL) return <HiddenSentinelRow key={id} />;
              const m = byId(id);
              if (!m) return null;
              return (
                <SortableRailRow
                  key={id}
                  module={m}
                  badge={badges(m)}
                  dimmed={draft.indexOf(id) > draft.indexOf(HIDDEN_SENTINEL)}
                />
              );
            })}
            {/* Порты следуют черновику (слот сепаратора учтён в индексах). */}
            {draft
              .filter((id) => id !== HIDDEN_SENTINEL)
              .map((id) => {
                const m = byId(id);
                if (!m) return null;
                return (
                  <RailPort key={id} module={m} index={draft.indexOf(id)} active={isActive(m)} />
                );
              })}
          </div>
        </SortableContext>
      </DndContext>
      <div className="mx-3 mt-2 flex flex-col gap-2">
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={apply}>
            {ui.nav.customizeDone}
          </Button>
          <Button size="sm" variant="outline" className="flex-1" onClick={onCancel}>
            {ui.common.cancel}
          </Button>
        </div>
      </div>
    </>
  );
}
