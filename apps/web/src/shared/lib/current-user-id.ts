/**
 * Идентификатор текущего пользователя для слоёв, которым нельзя зависеть от
 * auth-store напрямую (persist-хранилища и хуки shared): тесты подменяют
 * auth-store целиком, и вызов `useAuthStore.getState()` в потребителе ломал
 * бы их моки. Значение обновляет auth-store при каждом изменении сессии.
 */
let currentUserId: string | null = null;

export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}
