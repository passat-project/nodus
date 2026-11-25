/**
 * Эпоха сессии вкладки (AUD-005): номер меняется при каждом сбросе — выход,
 * мёртвая сессия, чужой refresh (`shared/session-reset.ts`). Мутация,
 * начатая в прежней сессии, переживает сброс (ответ идёт по сети), и её
 * колбэки не должны писать в чистый кэш данные прежнего пользователя —
 * `queryClient.clear()` их не отменяет. Клиент запросов привязывает колбэки
 * мутации к эпохе старта (`shared/lib/query-client.ts`).
 */
let epoch = 0;

export function currentSessionEpoch(): number {
  return epoch;
}

/** Начать новую эпоху — в начале сброса сессии, до чистки кэшей. */
export function nextSessionEpoch(): number {
  epoch += 1;
  return epoch;
}
