import { uiPx } from '../../../shared/ui/ui-scale.js';

/** Шаг точек и радиус — как у `Background` автоматизации (React Flow:
 *  gap=28, size=1, `fill: var(--edge)`, opacity 0.7 — flow-theme.css). */
const GAP_PX = 28;
const RADIUS_PX = 1;

/**
 * Точечный фон канваса структуры (#768, вердикт 16.11.2026 — «как в
 * автоматизации»): отдельный слой ВНУТРИ вьюпорта, под контентом. Паттерн
 * бесконечный: слой не в контенте, поэтому точки едут и масштабируются с
 * полотном — размер сетки `gap × zoom`, сдвиг — `view.x/view.y`, радиус ×
 * zoom. Радиус в дизайн-px (`uiPx`) — как hairline контура при UI-масштабе
 * 1.25. Слой не ловит мышь (`pointer-events-none`) и скрыт от скринридера.
 */
export function StructureDots({ x, y, zoom }: { x: number; y: number; zoom: number }) {
  const gap = uiPx(GAP_PX) * zoom;
  const radius = uiPx(RADIUS_PX) * zoom;
  return (
    <div
      aria-hidden
      data-structure-dots
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: `radial-gradient(circle, var(--edge) ${radius}px, transparent ${radius}px)`,
        backgroundSize: `${gap}px ${gap}px`,
        backgroundPosition: `${x}px ${y}px`,
        opacity: 0.7,
      }}
    />
  );
}
