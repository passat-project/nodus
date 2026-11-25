/**
 * Значок «смотреть» для видео-превью (#250, уточнение владельца 25.11.2026):
 * треугольник посажен по ОПТИЧЕСКОМУ центру. Геометрический bbox-центр кружка
 * глаз читает как перекос влево: масса треугольника слева от bbox-центра.
 * Сдвиг +1.6 единиц из 24 (≈6.7 %) ставит центроид (8.6+18.6+8.6)/3 ≈ 11.93
 * к центру 12, а bbox уходит на +1.6 — баланс, как у play-глифов Material.
 * Один глиф на плитку ленты, карточный список и витрину «Видео».
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
      <path d="M8.6 5.4 18.6 12 8.6 18.6Z" />
    </svg>
  );
}
