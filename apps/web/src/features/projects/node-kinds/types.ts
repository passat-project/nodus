import type { ReactNode } from 'react';

/** Слот «Создать атрибут…» (#556, Р15): композиция на уровне app (I6) —
 *  фича проектов не импортирует фичу автоматизации; `AutomationRoute`
 *  подставляет окно атрибута с областью «Папка». */
export interface CreateFieldSlot {
  onClose: () => void;
  onCreated: (id: string) => void;
}

export type RenderCreateField = (slot: CreateFieldSlot) => ReactNode;
