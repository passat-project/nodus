import { Injectable } from '@nestjs/common';
import {
  CHAT_EVENTS,
  CORRESPONDENCE_EVENTS,
  DIRECTORY_EVENTS,
  PROJECT_EVENTS,
  TASK_EVENTS,
  type DomainEvent,
} from '@nodus/contracts';

import { SearchIndexService } from './search-index.service.js';

/**
 * Обработчики outbox → проекция поиска (#952, Р6): один runner на все
 * источники, по одному классу-подписчику на группу событий (`eventTypes` на
 * типе конструктора — аддитивное расширение O1, диспетчер понимает).
 *
 * Индексация точечная: событие несёт id, провайдер модуля-владельца читает
 * актуальное состояние сам. Обработчик обязан быть идемпотентным (at-least-
 * once): upsert по версии это обеспечивает.
 */
@Injectable()
export class SearchIndexRunner {
  constructor(private readonly index: SearchIndexService) {}

  async run(event: DomainEvent<Record<string, unknown>>): Promise<void> {
    const payload = event.payload;
    switch (event.type) {
      case TASK_EVENTS.CREATED:
      case TASK_EVENTS.UPDATED:
      case TASK_EVENTS.ASSIGNED:
      case TASK_EVENTS.PARTICIPANTS_CHANGED:
      case TASK_EVENTS.DELETED:
        return this.one('task', text(payload['taskId']));

      case CHAT_EVENTS.MESSAGE_SENT:
      case CHAT_EVENTS.MESSAGE_EDITED:
      case CHAT_EVENTS.MESSAGE_DELETED:
        return this.one('message', text(payload['messageId']));

      case CORRESPONDENCE_EVENTS.LETTER_RECEIVED:
      case CORRESPONDENCE_EVENTS.LETTER_REGISTERED:
      case CORRESPONDENCE_EVENTS.LETTER_UPDATED:
      case CORRESPONDENCE_EVENTS.LETTER_PARTICIPANTS_CHANGED:
      case CORRESPONDENCE_EVENTS.LETTER_RELATIONS_CHANGED:
      case CORRESPONDENCE_EVENTS.LETTER_DELETED:
        return this.one('letter', text(payload['letterId']));

      case PROJECT_EVENTS.CREATED:
      case PROJECT_EVENTS.UPDATED:
        return this.one('project', text(payload['projectId']));

      case DIRECTORY_EVENTS.USER_CREATED:
      case DIRECTORY_EVENTS.USER_UPDATED:
      case DIRECTORY_EVENTS.USER_DEACTIVATED:
      case DIRECTORY_EVENTS.USER_ACTIVATED:
        return this.one('employee', text(payload['userId']));

      case DIRECTORY_EVENTS.DEPARTMENT_UPDATED:
      case DIRECTORY_EVENTS.DEPARTMENT_ARCHIVED: {
        const departmentId = text(payload['departmentId']);
        if (departmentId) await this.index.indexByDepartment(departmentId);
        return;
      }

      case DIRECTORY_EVENTS.POSITION_UPDATED: {
        // Переназначение (`changedFields=['holders']`): держатели у старой
        // должности уже новые — обновляем и по userIds, и по целевой
        // должности (план #952 §6).
        const fields = Array.isArray(payload['changedFields']) ? payload['changedFields'] : [];
        const holders = fields.includes('holders');
        if (holders) {
          const userIds = Array.isArray(payload['userIds'])
            ? payload['userIds'].filter((id): id is string => typeof id === 'string')
            : [];
          if (userIds.length > 0) await this.index.indexIds('employee', userIds);
          const targetId = text(payload['targetId']);
          if (targetId) await this.index.indexByPosition(targetId);
        }
        const positionId = text(payload['positionId']);
        if (positionId) await this.index.indexByPosition(positionId);
        return;
      }

      case DIRECTORY_EVENTS.POSITION_DELETED: {
        const positionId = text(payload['positionId']);
        if (positionId) await this.index.indexByPosition(positionId);
        return;
      }

      default:
        return;
    }
  }

  private async one(
    type: 'task' | 'letter' | 'message' | 'project' | 'employee',
    id: string | null,
  ): Promise<void> {
    if (id) await this.index.indexIds(type, [id]);
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Один класс-подписчик на группу типов событий (диспетчер читает
 *  `eventTypes`). Имя класса уникально (#556): диспетчер различает
 *  обработчиков по `constructor.name` в журнале доставок и в error-логах. */
const handlerFor = (name: string, eventTypes: readonly string[]) => {
  @Injectable()
  class Handler {
    static readonly eventTypes = eventTypes;
    constructor(readonly runner: SearchIndexRunner) {}
    handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
      return this.runner.run(event);
    }
  }
  Object.defineProperty(Handler, 'name', { value: name });
  return Handler;
};

export const SearchIndexTaskHandler = handlerFor('SearchIndexTaskHandler', [
  TASK_EVENTS.CREATED,
  TASK_EVENTS.UPDATED,
  TASK_EVENTS.ASSIGNED,
  TASK_EVENTS.PARTICIPANTS_CHANGED,
  TASK_EVENTS.DELETED,
]);

export const SearchIndexMessageHandler = handlerFor('SearchIndexMessageHandler', [
  CHAT_EVENTS.MESSAGE_SENT,
  CHAT_EVENTS.MESSAGE_EDITED,
  CHAT_EVENTS.MESSAGE_DELETED,
]);

export const SearchIndexLetterHandler = handlerFor('SearchIndexLetterHandler', [
  CORRESPONDENCE_EVENTS.LETTER_RECEIVED,
  CORRESPONDENCE_EVENTS.LETTER_REGISTERED,
  CORRESPONDENCE_EVENTS.LETTER_UPDATED,
  CORRESPONDENCE_EVENTS.LETTER_PARTICIPANTS_CHANGED,
  // Номера приложенных писем лежат в body (провайдер) — смена связей
  // обязана переиндексировать источник (code-reviewer #952).
  CORRESPONDENCE_EVENTS.LETTER_RELATIONS_CHANGED,
  CORRESPONDENCE_EVENTS.LETTER_DELETED,
]);

export const SearchIndexProjectHandler = handlerFor('SearchIndexProjectHandler', [
  PROJECT_EVENTS.CREATED,
  PROJECT_EVENTS.UPDATED,
]);

export const SearchIndexDirectoryHandler = handlerFor('SearchIndexDirectoryHandler', [
  DIRECTORY_EVENTS.USER_CREATED,
  DIRECTORY_EVENTS.USER_UPDATED,
  DIRECTORY_EVENTS.USER_DEACTIVATED,
  DIRECTORY_EVENTS.USER_ACTIVATED,
  DIRECTORY_EVENTS.DEPARTMENT_UPDATED,
  DIRECTORY_EVENTS.DEPARTMENT_ARCHIVED,
  DIRECTORY_EVENTS.POSITION_UPDATED,
  DIRECTORY_EVENTS.POSITION_DELETED,
]);
