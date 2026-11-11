import { useState } from 'react';

/**
 * Состояние панели свойств и активной строки структуры (#556, #731): клик по
 * папке подсвечивает строку, панель открывается только командой «Свойства».
 * Два связанных состояния вкладки живут рядом, без «прыжков» между ними.
 */
export function useStructurePanels() {
  const [propertiesId, setPropertiesId] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  return { propertiesId, setPropertiesId, activeNodeId, setActiveNodeId } as const;
}
