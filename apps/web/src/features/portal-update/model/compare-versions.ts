/**
 * Сравнение версий «major.minor.patch» без зависимостей (#1038): выпуски
 * портала — строгий semver без префиксов и билд-меток (release-schema).
 * Кривые входы не бросают: нечисловая или отсутствующая часть = 0, хвост
 * за третьей позицией игнорируется.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseParts(a);
  const pb = parseParts(b);
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** Числовые части версии: Number + isFinite (мусор/undefined → 0). */
function parseParts(version: string): [number, number, number] {
  const parts = version.split('.');
  const at = (i: number): number => {
    const n = Number(parts[i]);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  };
  return [at(0), at(1), at(2)];
}
