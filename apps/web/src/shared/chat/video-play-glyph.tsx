/**
 * Значок «смотреть» для видео-превью (#250, уточнение владельца 25.11.2026):
 * треугольник посажен РОВНО по центру собственных границ (bbox x 7–17, y 5.4–18.6
 * при viewBox 24×24) — без ручных `translate-x`, из-за которых на миниатюре
 * 14–24 px кнопка читалась кривой. Один глиф на плитку ленты, карточный список
 * и витрину «Видео»: одна грамматика во всех местах.
 */
export function VideoPlayGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`video-play-glyph ${className ?? ''}`}
      fill="currentColor"
      shapeRendering="geometricPrecision"
    >
      <path d="M7 5.4 17 12 7 18.6Z" />
    </svg>
  );
}
