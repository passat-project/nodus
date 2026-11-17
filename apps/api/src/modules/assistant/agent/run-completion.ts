import { Injectable } from '@nestjs/common';

import { PinoLogger } from 'nestjs-pino';

/**
 * Сигнал «прогон сессии завершён» (#916) без циклической зависимости:
 * `AgentRunnerService` не знает о продолжении после карточек, а
 * `AssistantContinuationService` подписывается на завершение и добивает
 * отложенное автопродолжение (решение пришло, пока агент ещё печатал).
 *
 * Обработчики живут в памяти процесса: перезапуск сервера теряет отложенное
 * продолжение, но пачка остаётся открытой — сотрудник увидит «Продолжить
 * сейчас» в ленте (запасной путь, без таймеров).
 */
@Injectable()
export class RunCompletionNotifier {
  private readonly handlers = new Set<(sessionId: string) => void>();

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(RunCompletionNotifier.name);
  }

  /** Подписка; возвращает отписку (тесты и горячая замена). */
  register(handler: (sessionId: string) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Завершение любого прогона сессии: ошибка обработчика не валит прогон. */
  notify(sessionId: string): void {
    for (const handler of this.handlers) {
      try {
        handler(sessionId);
      } catch (error) {
        this.logger.warn({ err: error, sessionId }, 'Run completion handler failed');
      }
    }
  }
}
