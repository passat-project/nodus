/** Sequence внутренних номеров атрибутов мок-мира (#632): общий для
 *  основного реестра и демо-формул; явный номер резервирует диапазон,
 *  чтобы следующий выданный не повторил его. */
let nextNumber = 1;

export function takeFieldNumber(): number {
  return nextNumber++;
}

export function reserveFieldNumber(number: number): void {
  nextNumber = Math.max(nextNumber, number + 1);
}

export function nextFieldNumber(): number {
  return nextNumber++;
}
