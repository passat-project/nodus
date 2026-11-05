import type { TaskRef } from '@nodus/contracts';

/**
 * Read-порт задач для чата (ADR-0012, #252): беседа задачи — обычная беседа
 * мессенджера `type='task'`, её состав = участники задачи. Модуль chat
 * читает состав, ссылки и видимость через этот порт, не трогая таблицы
 * задач (I3/I6). Владелец данных — tasks (провайдер рядом), экспорт —
 * TasksPortsModule; доменные сервисы задач не экспортируются.
 */
export const TASK_CHAT_READER = Symbol('TASK_CHAT_READER');

export interface TaskChatMember {
  userId: string;
  /** Наблюдатель — без звука (Битрикс24); остальные — со звуком. */
  muted: boolean;
}

export interface TaskChatRoster {
  creatorId: string;
  members: TaskChatMember[];
}

export interface TaskChatReader {
  /** Состав чата задачи (постановщик, ответственный, соисполнители,
   *  наблюдатели); null — задачи нет или она удалена. */
  roster(taskId: string): Promise<TaskChatRoster | null>;

  /** Ссылки на задачи (номер + название) для строк списка бесед. */
  refs(taskIds: string[]): Promise<TaskRef[]>;

  /** Видна ли задача пользователю (та же функция видимости модуля задач). */
  canView(taskId: string, user: { id: string; permissions: readonly string[] }): Promise<boolean>;

  /** Решающий ли пользователь текущего шага (#433): только ему чат задачи
   *  открывается read-only, остальным невидимым — нет. */
  isDecider(taskId: string, userId: string): Promise<boolean>;
}
