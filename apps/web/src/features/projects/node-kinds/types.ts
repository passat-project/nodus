import type { ReactNode } from 'react';
import type { NodeKind } from '@nodus/contracts';

/** Слот «Создать атрибут…» (#556, Р15): композиция на уровне app (I6) —
 *  фича проектов не импортирует фичу автоматизации; `AutomationRoute`
 *  подставляет окно атрибута с областью «Папка». */
export interface CreateFieldSlot {
  onClose: () => void;
  onCreated: (id: string) => void;
}

export type RenderCreateField = (slot: CreateFieldSlot) => ReactNode;

/** Вид папки, открытый в панели (deep-link `?kind=<id>`). */
export interface NodeKindSelection {
  kind: NodeKind | null;
  onSelect: (id: string | null) => void;
}
