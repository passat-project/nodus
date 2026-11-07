import { Module } from '@nestjs/common';

import { USER_PROFILE_READER } from '../../core/ports/user-profile.port.js';
import { UserProfileProvider } from '../../core/ports/user-profile.provider.js';
import { CrmPortsModule } from '../crm/crm-ports.module.js';
import { CustomFieldsPortsModule } from '../custom-fields/custom-fields-ports.module.js';
import { DictionariesPortsModule } from '../dictionaries/dictionaries-ports.module.js';
import { WorkflowsPortsModule } from '../workflows/workflows-ports.module.js';
import { LetterFileAccess } from './access/letter-file-access.js';
import { LetterFieldValuesCleanupHandler } from './events/letter-field-values-cleanup.handler.js';
import { LetterFormulaLifecycleHandler } from './events/letter-formula-lifecycle.handler.js';
import {
  LetterFormulaDefinitionHandler,
  LetterFormulaRecalcHandler,
  LetterFormulaRegisteredHandler,
} from './events/letter-formula-recalc.handler.js';
import {
  LetterFormulaNodeSourceHandler,
  LetterFormulaProjectSourceHandler,
  LetterFormulaTaskSourceHandler,
} from './events/letter-formula-source.handler.js';
import {
  LetterFormulaAssignedSourceHandler,
  LetterFormulaDeletedSourceHandler,
  LetterFormulaNodeDeletedSourceHandler,
  LetterFormulaStageSourceHandler,
  LetterFormulaTaskSystemRunner,
} from './events/letter-formula-system-source.handler.js';
import { LetterHistoryRepository } from './history/letter-history.repository.js';
import { LetterHistoryService } from './history/letter-history.service.js';
import { LetterAttachedRefsRepository } from './letters/letter-attached-refs.repository.js';
import { LetterAttachedRefsValidator } from './letters/letter-attached-refs.validator.js';
import { LetterDtoMapper } from './letters/letter-dto.mapper.js';
import { LetterFieldsValidator } from './letters/letter-fields.validator.js';
import { LetterFieldsWriter } from './letters/letter-fields.writer.js';
import { LetterFormulaController } from './letters/letter-formula.controller.js';
import { LetterFormulaService } from './letters/letter-formula.service.js';
import { LetterRelationsController } from './letters/letter-relations.controller.js';
import { LetterRelationsRepository } from './letters/letter-relations.repository.js';
import { LettersController } from './letters/letters.controller.js';
import { LettersManualCreateService } from './letters/letters-manual-create.service.js';
import { LettersMainDocumentService } from './letters/letters-main-document.service.js';
import { LettersMutationService } from './letters/letters-mutation.service.js';
import { LettersQueryService } from './letters/letters-query.service.js';
import { LettersRelationService } from './letters/letters-relation.service.js';
import { LettersRepository } from './letters/letters.repository.js';
import { LettersTreeService } from './letters/letters-tree.service.js';
import { LetterThreadingService } from './letters/letter-threading.service.js';
import { LetterBodyPdfQueue } from './mail/body-pdf/letter-body-pdf.queue.js';
import { LetterBodyPdfService } from './mail/body-pdf/letter-body-pdf.service.js';
import { LetterBodyPdfWorker } from './mail/body-pdf/letter-body-pdf.worker.js';
import { MailInboxService } from './mail/mail-inbox.service.js';
import { MailLetterWriter } from './mail/mail-letter-writer.js';
import { ProjectsPortsModule } from '../projects/projects-ports.module.js';
import { MailModule } from './mail/mail.module.js';
import { MailPollJob } from './mail/mail-poll.job.js';
import { SmtpOutboxTransport } from './mail/smtp-outbox.transport.js';
import { LetterFormApplier } from './workflow/letter-form.applier.js';
import { LetterStageMover } from './workflow/letter-stage.mover.js';
import { LetterTransitionsService } from './workflow/letter-transitions.service.js';
import { LetterWorkflowAdapter } from './workflow/letter-workflow.adapter.js';

/**
 * Модуль корреспонденции (#55, ADR-0027): письма на движке «Процессы»
 * (категория `letter`) — очередь «Новые», регистрация с нумерацией,
 * журналы «Входящие»/«Исходящие», карточка с реквизитами, файлами и
 * историей, чат письма (мост через порт `LETTER_CHAT_READER`), правка
 * регистрационных данных и удаление спама. Изоляция (I3/I6): типы, стадии и
 * движок — порты «Процессов»; корреспондент и подписант — порт CRM;
 * справочник способов поступления — порт справочников; файлы — порт
 * `FILE_STORAGE`/`FILE_OBJECT_READER`; сотрудники — read-порт core. Флаг
 * `correspondence` (I10). Адаптер маршрута регистрируется DiscoveryService
 * по `static readonly workflowCategory = 'letter'`.
 */
@Module({
  imports: [
    WorkflowsPortsModule,
    CustomFieldsPortsModule,
    CrmPortsModule,
    DictionariesPortsModule,
    // Read-порт проектов (#52): привязка письма (валидатор) и ссылка
    // project в DTO (маппер) — без прямого доступа к таблицам проектов.
    ProjectsPortsModule,
    MailModule,
  ],
  controllers: [LettersController, LetterRelationsController, LetterFormulaController],
  providers: [
    UserProfileProvider,
    { provide: USER_PROFILE_READER, useClass: UserProfileProvider },
    // Репозитории — единственная точка доступа к таблицам модуля (patterns.md).
    LettersRepository,
    LetterRelationsRepository,
    LetterAttachedRefsRepository,
    // Уборка значений удалённого атрибута (#582): событие custom_field.definition_changed.
    LetterFieldValuesCleanupHandler,
    // Формулы ячеек атрибутов письма (#632): писатель значений, мутации
    // формулы (PUT/DELETE у владельца хоста, I3) и пересчёт по событиям.
    LetterFieldsWriter,
    LetterFormulaService,
    LetterFormulaRecalcHandler,
    LetterFormulaRegisteredHandler,
    LetterFormulaDefinitionHandler,
    // Уборка ячеек удалённого письма (#632).
    LetterFormulaLifecycleHandler,
    // Формулы писем по событиям-источникам (#632): значения задач, проектов
    // и папок, прочитанные по атрибуту-ссылке (I3 — пишутся только письма).
    LetterFormulaTaskSourceHandler,
    // Общий пересчёт писем по системным полям задачи (стадия/ответственный):
    // зависит от него каждый из системных handler'ов ниже.
    LetterFormulaTaskSystemRunner,
    LetterFormulaStageSourceHandler,
    LetterFormulaAssignedSourceHandler,
    LetterFormulaDeletedSourceHandler,
    LetterFormulaProjectSourceHandler,
    LetterFormulaNodeSourceHandler,
    LetterFormulaNodeDeletedSourceHandler,
    LetterFileAccess,
    LetterHistoryRepository,
    LetterDtoMapper,
    LettersQueryService,
    LettersTreeService,
    LettersRelationService,
    LetterFieldsValidator,
    LetterAttachedRefsValidator,
    LetterThreadingService,
    LetterFormApplier,
    LetterStageMover,
    LetterWorkflowAdapter,
    LettersMutationService,
    LettersManualCreateService,
    LettersMainDocumentService,
    LetterTransitionsService,
    LetterHistoryService,
    // Доменный цикл приёма почты (#56): живёт здесь — зависим от сервисов писем
    // (репозиторий, цепочки), транспортная обвязка — MailModule.
    MailLetterWriter,
    MailInboxService,
    MailPollJob,
    SmtpOutboxTransport,
    // «Основной документ письма» #56: фоновая PDF-копия тела (BullMQ) —
    // кандидат основного документа, конвертация через порт DOCUMENT_CONVERTER
    // (реализация — files/Gotenberg, тот же конвертер, что у производных).
    LetterBodyPdfQueue,
    LetterBodyPdfService,
    LetterBodyPdfWorker,
  ],
})
export class CorrespondenceModule {}
