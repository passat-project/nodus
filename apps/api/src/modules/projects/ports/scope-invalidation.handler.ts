import { Injectable } from '@nestjs/common';
import { PROJECT_EVENTS } from '@nodus/contracts';

import { ProjectReaderProvider } from './project-reader.provider.js';

/**
 * Инвалидация кэша множеств видимости (Р3): TTL 5 с держит горячие фиды,
 * но создание/смена полей/состава проекта меняет множества — событие
 * outbox (доставка ~50 мс) сбрасывает кэш, и «создал проект → сразу
 * задача» не упирается в устаревший скоуп.
 */
@Injectable()
export class ProjectScopeInvalidateRunner {
  constructor(private readonly reader: ProjectReaderProvider) {}

  handle(): void {
    this.reader.invalidateScopeCache();
  }
}

const handlerFor = (eventType: string) => {
  @Injectable()
  class Handler {
    static readonly eventType = eventType;
    constructor(readonly runner: ProjectScopeInvalidateRunner) {}
    handle(): void {
      this.runner.handle();
    }
  }
  return Handler;
};

@Injectable()
export class ProjectCreatedScopeHandler extends handlerFor(PROJECT_EVENTS.CREATED) {}
@Injectable()
export class ProjectUpdatedScopeHandler extends handlerFor(PROJECT_EVENTS.UPDATED) {}
@Injectable()
export class ProjectParticipantsScopeHandler extends handlerFor(
  PROJECT_EVENTS.PARTICIPANTS_CHANGED,
) {}
/** Автопересчёт состава (#699): множества видимости меняются так же. */
@Injectable()
export class ProjectRosterSyncedScopeHandler extends handlerFor(PROJECT_EVENTS.ROSTER_SYNCED) {}
