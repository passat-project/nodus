/** Дельта счётчиков шапок канбана при оптимистичном переносе карточки:
 *  `stage.count` серверный, локальный перенос корректирует до инвалидации,
 *  откат — обратная дельта. Перестановка ВНУТРИ колонки (`fromId === toId`)
 *  счётчик не меняет: иначе одна и та же запись объекта дважды пишется
 *  вычисляемым ключом (`+1` перетирается `-1`) и шапка теряет задачу. */
export function bumpCountDelta(
  prev: Record<string, number>,
  fromId: string,
  toId: string,
  delta: 1 | -1,
): Record<string, number> {
  if (fromId === toId) return prev;
  return {
    ...prev,
    [toId]: (prev[toId] ?? 0) + delta,
    [fromId]: (prev[fromId] ?? 0) - delta,
  };
}
