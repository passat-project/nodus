import { Injectable } from '@nestjs/common';
import { PROJECT_EVENTS, type DomainEvent } from '@nodus/contracts';

import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import { ProjectChatHandlers } from './project-chat.service.js';

/**
 * Подписчики project.* (I3: chat узнаёт о проектах только событиями):
 * создание/изменение состава — синк канала, переименование — заголовок.
 * Идемпотентны (повторная доставка outbox приводит к тому же каналу).
 */
@Injectable()
class ProjectChatHandlerRunner {
  constructor(
    readonly handlers: ProjectChatHandlers,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  async run(
    method: 'created' | 'participantsChanged' | 'updated',
    event: DomainEvent<Record<string, unknown>>,
  ): Promise<void> {
    if (!(await this.featureFlags.isEnabled('chat'))) return;
    await this.handlers[method](event);
  }
}

export { ProjectChatHandlerRunner };

const handlerFor = (eventType: string, method: 'created' | 'participantsChanged' | 'updated') => {
  @Injectable()
  class Handler {
    static readonly eventType = eventType;
    constructor(readonly runner: ProjectChatHandlerRunner) {}
    handle(event: DomainEvent<Record<string, unknown>>): Promise<void> {
      return this.runner.run(method, event);
    }
  }
  return Handler;
};

@Injectable()
export class ProjectCreatedChatHandler extends handlerFor(PROJECT_EVENTS.CREATED, 'created') {}
@Injectable()
export class ProjectParticipantsChatHandler extends handlerFor(
  PROJECT_EVENTS.PARTICIPANTS_CHANGED,
  'participantsChanged',
) {}
/** Автопересчёт состава (#699): для ростера канала — то же изменение. */
@Injectable()
export class ProjectRosterSyncedChatHandler extends handlerFor(
  PROJECT_EVENTS.ROSTER_SYNCED,
  'participantsChanged',
) {}
@Injectable()
export class ProjectUpdatedChatHandler extends handlerFor(PROJECT_EVENTS.UPDATED, 'updated') {}
