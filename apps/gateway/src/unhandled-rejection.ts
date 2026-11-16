import type { EventEmitter } from 'node:events';

/**
 * Глобальный обработчик необработанных отказов gateway (AUD-018, P0): сбой
 * фоновой задачи логируется и НЕ завершает процесс. `uncaughtException`
 * намеренно не перехватывается: синхронные исключения по-прежнему фатальны.
 * Эмиттер — параметр, чтобы обработчик покрывался тестом без подмены
 * глобального `process`.
 */
export function registerUnhandledRejectionHandler(
  logError: (message: string, reason: unknown) => void,
  emitter: EventEmitter = process,
): void {
  emitter.on('unhandledRejection', (reason: unknown) => {
    logError('Необработанный отказ в фоновой задаче', reason);
  });
}
