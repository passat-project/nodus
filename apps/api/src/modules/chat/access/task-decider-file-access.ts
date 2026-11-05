import { Inject, Injectable } from '@nestjs/common';

import type {
  FileAccessContributor,
  FileAccessDecision,
} from '../../../core/ports/file-access.port.js';
import { TASK_CHAT_READER, type TaskChatReader } from '../../tasks/ports/task-chat-reader.port.js';
import { TaskDeciderFileAccessRepository } from '../file-access/task-decider-file-access.repository.js';

/**
 * Вложения задачи для решающего вне задачи (#433): файл, приложенный к
 * беседе задачи, виден держателю текущего шага, но НЕ правится. Отдельный
 * контрибьютор с тем же маркером `chat`, что и `ChatFileAccess`: реестр
 * объединяет решения по OR, а модуль-«мост» остаётся самодостаточным.
 */
@Injectable()
export class TaskDeciderFileAccess implements FileAccessContributor {
  static readonly fileAccessContext = 'chat';
  readonly fileAccessContext = TaskDeciderFileAccess.fileAccessContext;

  constructor(
    private readonly repository: TaskDeciderFileAccessRepository,
    @Inject(TASK_CHAT_READER) private readonly tasks: TaskChatReader,
  ) {}

  async check(fileId: string, userId: string): Promise<FileAccessDecision | null> {
    for (const taskId of await this.repository.taskIdsByFileId(fileId)) {
      if (await this.tasks.isDecider(taskId, userId)) {
        return { canView: true, canEdit: false };
      }
    }
    return null;
  }
}
