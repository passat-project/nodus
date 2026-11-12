import { Global, Module } from '@nestjs/common';

import { AVATAR_PROCESSOR } from '../../core/ports/avatar-processor.port.js';
import { FILE_STORAGE } from '../../core/ports/file-storage.port.js';
import { FileStorageProvider } from './file-storage.provider.js';
import { FILES_CONFIG, getFilesConfig } from './files.config.js';
import { FilesController } from './files.controller.js';
import { DiscoveryModule } from '@nestjs/core';
import { FILE_OBJECT_READER } from '../../core/ports/file-object-reader.port.js';
import { FileAccessRegistry } from '../../core/ports/file-access.registry.js';
import { FilesRepository } from './files.repository.js';
import { FileObjectReaderProvider } from './ports/file-object-reader.provider.js';
import { MinioStorageDriver } from './storage/minio-storage.driver.js';
import { OFFICE_CONFIG, getOfficeConfig } from './office/office.config.js';
import { OfficeCallbackService } from './office/office-callback.service.js';
import { OfficeController } from './office/office.controller.js';
import { OfficeSessionService } from './office/office-session.service.js';
import { OfficeTokenService } from './office/office-token.service.js';
import { DERIVATIVES_CONFIG, getDerivativesConfig } from './derivatives/derivatives.config.js';
import { GotenbergConverterProvider } from './derivatives/gotenberg-converter.provider.js';
import { DOCUMENT_CONVERTER } from '../../core/ports/document-converter.port.js';
import { DerivativesQueue } from './derivatives/derivatives.queue.js';
import { DerivativesRepository } from './derivatives/derivatives.repository.js';
import { DerivativesService } from './derivatives/derivatives.service.js';
import { DerivativesWorker } from './derivatives/derivatives.worker.js';
import { AvatarService } from './avatars/avatar.service.js';
import { StaleMultipartSweeper } from './storage/stale-multipart.sweeper.js';
import { StaleMultipartUploadsJob } from './storage/stale-multipart.job.js';
import { AttachmentSentHandler } from './events/attachment-sent.handler.js';
import { LetterReceivedHandler } from './events/letter-received.handler.js';

/**
 * Модуль files (M9, #57 ADR-0013 + #138 движок просмотра + #139 конвейер
 * производных): объектное хранилище + метаданные file_objects/file_versions
 * + ONLYOFFICE-сессии + PDF-производные (Gotenberg, очередь BullMQ).
 * Наружу (I3): порт FILE_STORAGE, GET /files/:id/content по подписи,
 * office-эндпоинты (#138). @Global — как CryptoModule: токен FILE_STORAGE
 * инжектится модулями-потребителями (chat, дальше correspondence) БЕЗ
 * межмодульного импорта (I3/I6); обратное направление (права контекста) —
 * реестр FileAccessRegistry: потребители регистрируют контрибьютора
 * статическим маркером `fileAccessContext`, DiscoveryService его находит.
 * Своего фичефлага нет: офис-движок гейтится OFFICE_ENABLED (внутри
 * колбэка/сессии), маршруты потребителя — под его флагом.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  controllers: [FilesController, OfficeController],
  providers: [
    { provide: FILES_CONFIG, useFactory: getFilesConfig },
    { provide: OFFICE_CONFIG, useFactory: getOfficeConfig },
    { provide: DERIVATIVES_CONFIG, useFactory: getDerivativesConfig },
    MinioStorageDriver,
    FilesRepository,
    FileAccessRegistry,
    FileObjectReaderProvider,
    { provide: FILE_OBJECT_READER, useExisting: FileObjectReaderProvider },
    FileStorageProvider,
    OfficeTokenService,
    OfficeSessionService,
    OfficeCallbackService,
    DerivativesRepository,
    DerivativesQueue,
    DerivativesService,
    DerivativesWorker,
    // Периодическая уборка брошенных multipart-загрузок (#715): страховка к
    // abort'у при сбое put — жёсткое падение процесса не отменить ничем.
    StaleMultipartSweeper,
    StaleMultipartUploadsJob,
    // Порт конвертации HTML→PDF («Основной документ письма» #56): потребитель
    // — correspondence (PDF-копия тела письма), реализация — рядом с
    // конвейером производных (тот же Gotenberg).
    GotenbergConverterProvider,
    { provide: DOCUMENT_CONVERTER, useExisting: GotenbergConverterProvider },
    // Аватарки (#186): общий конвейер квадратизации для chat и directory
    // (инжект классом из @Global-модуля, как FILE_STORAGE).
    AvatarService,
    // Запуск конвейера по подтверждению вложений (#139): files слушает
    // chat.message_sent — связь модулей событием (I3).
    AttachmentSentHandler,
    LetterReceivedHandler,
    { provide: FILE_STORAGE, useExisting: FileStorageProvider },
    // Аватарки (#186): порт для chat/directory (I3 — модули не импортируют
    // друг друга), реализация — AvatarService (см. avatars/).
    { provide: AVATAR_PROCESSOR, useExisting: AvatarService },
  ],
  exports: [
    FILE_STORAGE,
    FILE_OBJECT_READER,
    FileAccessRegistry,
    AVATAR_PROCESSOR,
    DOCUMENT_CONVERTER,
  ],
})
export class FilesModule {}
