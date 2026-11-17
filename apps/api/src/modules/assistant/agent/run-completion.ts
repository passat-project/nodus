import { Injectable } from '@nestjs/common';

import { PinoLogger } from 'nestjs-pino';

/**
 * Сигнал «прогон сессии завершён» (#916) без циклической зависимости:
 * `AgentRunnerService` не знает о продолжении после карточек, а
 * `AssistantContinuationService` подписывается на завершение и добивает
 * отложенное автопродолжение (решение пришло, пока агент ещё печатал).
 *
 * Обработчики живут в памяти процесса. Перезапуск сервера в окне ожидания
 * теряет резерв — `AssistantContinuationService.onModuleInit` закрывает такие
 * `queued`-прогоны (`interrupted`) и возвращает пачки в `open`, чтобы
 * «Продолжить сейчас» вёл в живой прогон, а не в мёртвый (валидация 18.11.2026).
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
