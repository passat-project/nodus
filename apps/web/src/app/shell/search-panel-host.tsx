import { SearchPanel } from '../../features/search/components/search-panel.js';
import { useSearchStore } from '../../features/search/model/search-store.js';
import { useCircuitAxisY } from './use-circuit-axis.js';

/**
 * Мост «каркас ↔ поиск» (#952): геометрия рабочего окна — на живой оси
 * контура (низ топбара / хедере карточки-мессенджера), как у окна ассистента.
 * Фича search не знает каркас (направление слоёв app → features → shared):
 * панель получает готовый `top`.
 */
export function SearchPanelHost() {
  const open = useSearchStore((state) => state.mode === 'workspace');
  const axisY = useCircuitAxisY();
  if (!open || axisY === null) return null;
  return <SearchPanel top={axisY} />;
}
