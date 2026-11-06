import { Injectable } from '@nestjs/common';
import { CUSTOM_FIELD_EVENTS, type FormulaHostKind } from '@nodus/contracts';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { EventBus } from '../../core/events/event-bus.js';
import { projectAudience } from './project-audience.js';
import { ProjectParticipantsRepository } from './project-participants.repository.js';
import { ProjectsRepository } from './projects.repository.js';

/**
 * Адресное событие формулы ячейки проекта/папки (#632, O4): эмитится
 * владельцем хоста при смене формулы, снятии и смене состояния ошибки —
 * каталожный broadcast раскрывал бы hostId конфиденциальных записей.
 * Аудитория — состав проекта (участники + руководство), без значений:
 * значения приезжают событиями хоста.
 */
@Injectable()
export class ProjectFormulaEvents {
  constructor(
    private readonly repo: ProjectsRepository,
    private readonly participants: ProjectParticipantsRepository,
    private readonly eventBus: EventBus,
  ) {}

  async emitChanged(
    tx: TransactionClient,
    actorId: string | null,
    hostKind: FormulaHostKind,
    hostId: string,
    projectId: string,
    fieldId: string,
    hasError: boolean,
  ): Promise<void> {
    const project = await this.repo.findById(projectId, tx);
    const audience = project ? await projectAudience(this.participants, project, tx) : [];
    await this.eventBus.emit(
      tx,
      CUSTOM_FIELD_EVENTS.FORMULA_CHANGED,
      { hostKind, hostId, fieldId, hasError, audience },
      {
        actorId: actorId ?? undefined,
        aggregateType: hostKind === 'node' ? 'project_node' : 'project',
        aggregateId: hostId,
      },
    );
  }
}
