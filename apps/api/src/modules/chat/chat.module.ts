import { Module } from '@nestjs/common';

import { USER_PROFILE_READER } from '../../core/ports/user-profile.port.js';
import { UserProfileProvider } from '../../core/ports/user-profile.provider.js';
import { ConversationItemMapper } from './conversations/conversation-item.mapper.js';
import { ConversationMembersController } from './conversations/conversation-members.controller.js';
import { ConversationMembersService } from './conversations/conversation-members.service.js';
import { ConversationsController } from './conversations/conversations.controller.js';
import { ConversationsRepository } from './conversations/conversations.repository.js';
import { ConversationsWriteRepository } from './conversations/conversations-write.repository.js';
import { ConversationMembersRepository } from './conversations/conversation-members.repository.js';
import { ConversationDraftsRepository } from './conversations/conversation-drafts.repository.js';
import { ConversationsService } from './conversations/conversations.service.js';
import { AttachmentsController } from './messages/attachments.controller.js';
import { AttachmentsRepository } from './messages/attachments.repository.js';
import { AttachmentsService } from './messages/attachments.service.js';
import { MessageActionsController } from './messages/message-actions.controller.js';
import { MessageActionsService } from './messages/message-actions.service.js';
import { MessagePinsService } from './messages/message-pins.service.js';
import { MessageReactionsService } from './messages/message-reactions.service.js';
import { ThreadWatchService } from './messages/thread-watch.service.js';
import { MessageDtoMapper } from './messages/message-dto.mapper.js';
import { MessagePinsRepository } from './messages/message-pins.repository.js';
import { MessagesController } from './messages/messages.controller.js';
import { MessagesRepository } from './messages/messages.repository.js';
import { MessagesWriteRepository } from './messages/messages-write.repository.js';
import { MessagesLifecycleRepository } from './messages/messages-lifecycle.repository.js';
import { MessagesReadStateRepository } from './messages/messages-read-state.repository.js';
import { MessagesReactionsRepository } from './messages/messages-reactions.repository.js';
import { MessagesDeleteService } from './messages/messages-delete.service.js';
import { MessagesService } from './messages/messages.service.js';
import { ThreadParticipantsRepository } from './messages/thread-participants.repository.js';
import { ThumbnailQueue } from './messages/thumbnail.queue.js';
import { ThumbnailService } from './messages/thumbnail.service.js';
import { ThumbnailWorker } from './messages/thumbnail.worker.js';
import { UrgentPolicyController } from './messages/urgent-policy.controller.js';
import { UrgentPolicyReader } from './messages/urgent-policy.reader.js';
import { FileVersionHandler } from './events/file-version.handler.js';
import { ProjectsPortsModule } from '../projects/projects-ports.module.js';
import { TasksPortsModule } from '../tasks/tasks-ports.module.js';
import { CorrespondencePortsModule } from '../correspondence/correspondence-ports.module.js';
import { WorkflowsPortsModule } from '../workflows/workflows-ports.module.js';
import { LetterChatController } from './letter-chat/letter-chat.controller.js';
import {
  LetterChatSyncRunner,
  LetterDeletedChatHandler,
  LetterParticipantsChatHandler,
  LetterRegisteredChatHandler,
  LetterUpdatedChatHandler,
} from './letter-chat/letter-chat.handlers.js';
import { LetterChatRepository } from './letter-chat/letter-chat.repository.js';
import { LetterChatService } from './letter-chat/letter-chat.service.js';
import { LetterTransitionBlockHandler } from './letter-chat/letter-transition-block.handler.js';
import { LetterTransitionBlockService } from './letter-chat/letter-transition-block.service.js';
import { ProjectChatController } from './project-chat/project-chat.controller.js';
import {
  ProjectCreatedChatHandler,
  ProjectParticipantsChatHandler,
  ProjectRosterSyncedChatHandler,
  ProjectUpdatedChatHandler,
  ProjectChatHandlerRunner,
} from './project-chat/project-chat.handlers.js';
import { ProjectChatRepository } from './project-chat/project-chat.repository.js';
import { ProjectChatHandlers, ProjectChatService } from './project-chat/project-chat.service.js';
import { TaskChatController } from './task-chat/task-chat.controller.js';
import {
  TaskAssignedChatHandler,
  TaskChatSyncRunner,
  TaskCreatedChatHandler,
  TaskDeletedChatHandler,
  TaskParticipantsChatHandler,
  TaskUpdatedChatHandler,
} from './task-chat/task-chat.handlers.js';
import { TaskChatRepository } from './task-chat/task-chat.repository.js';
import { TaskChatService } from './task-chat/task-chat.service.js';
import { TaskDeciderFileAccess } from './access/task-decider-file-access.js';
import { TaskDeciderFileAccessRepository } from './file-access/task-decider-file-access.repository.js';
import { TaskTransitionBlockHandler } from './task-chat/task-transition-block.handler.js';
import { TaskTransitionBlockService } from './task-chat/task-transition-block.service.js';
import {
  TaskPressReturnedBlockHandler,
  TaskPressSubmittedBlockHandler,
} from './task-chat/task-press-block.handler.js';
import { TaskPressBlockService } from './task-chat/task-press-block.service.js';
import { FavoritesController } from './favorites/favorites.controller.js';
import { FavoriteCardMapper } from './favorites/favorite-card.mapper.js';
import { FavoritesRepository } from './favorites/favorites.repository.js';
import { FavoriteSourcesRepository } from './favorites/favorite-sources.repository.js';
import { FavoritesService } from './favorites/favorites.service.js';
import { StickersController } from './stickers/stickers.controller.js';
import { StickerPackEvents } from './stickers/sticker-pack-events.js';
import { StickersRepository } from './stickers/stickers.repository.js';
import { StickersService } from './stickers/stickers.service.js';
import { VaultController } from './vault/vault.controller.js';
import { VaultRepository } from './vault/vault.repository.js';
import { VaultWriteRepository } from './vault/vault-write.repository.js';
import { VaultService } from './vault/vault.service.js';
import { LinkPreviewRepository } from './link-previews/link-preview.repository.js';
import { LinkPreviewQueue } from './link-previews/link-preview.queue.js';
import { LinkPreviewRateLimiter } from './link-previews/link-preview.rate-limiter.js';
import { LinkPreviewService } from './link-previews/link-preview.service.js';
import { LinkPreviewWorker } from './link-previews/link-preview.worker.js';
import {
  MessageEditedPreviewHandler,
  MessageLinksPreviewHandler,
} from './link-previews/message-links.handler.js';

/**
 * Модуль chat (M6, #58): беседы (direct/group/каналы), сообщения, треды,
 * реакции, закрепы, прочитанность, пересылка, вложения (#57: загрузка через
 * порт FILE_STORAGE модуля files, отдача по подписанным ссылкам). Изоляция (I3/I6): таблицы
 * чата — только через репозитории модуля; профили сотрудников — read-порт
 * USER_PROFILE_READER (ADR-0012; users — core-shared таблица, реализация в
 * core/ports). Модуль за
 * фичефлагом `chat` (I10) — гварды на контроллерах.
 */
@Module({
  // Read-порты владельцев (ADR-0012): состав, ссылки и видимость чата задачи
  // (#252) и письма (#55); каталог стадий — цвет чипа блока перехода письма.
  imports: [TasksPortsModule, CorrespondencePortsModule, WorkflowsPortsModule, ProjectsPortsModule],
  // Вложения (#57): порт FILE_STORAGE — @Global FilesModule (как CryptoModule),
  // без межмодульного импорта (I3/I6); здесь chat знает только интерфейс.
  controllers: [
    ConversationsController,
    ConversationMembersController,
    MessagesController,
    MessageActionsController,
    AttachmentsController,
    StickersController,
    FavoritesController,
    UrgentPolicyController,
    VaultController,
    TaskChatController,
    LetterChatController,
    ProjectChatController,
  ],
  providers: [
    // Вложения задачи решающему вне задачи (#433): read-only, тот же маркер
    // контекста `chat`; реестр прав файлов объединяет решения по OR.
    TaskDeciderFileAccess,
    TaskDeciderFileAccessRepository,
    // Агрегат Conversation по ответственности (I5): чтение / запись беседы /
    // запись участия / черновики.
    ConversationsRepository,
    ConversationsWriteRepository,
    ConversationMembersRepository,
    ConversationDraftsRepository,
    ConversationsService,
    // Участники беседы (#186): добавление/роли/исключение — права матрицей.
    ConversationMembersService,
    ConversationItemMapper,
    // Агрегат Message по ответственности (I5): чтение / запись отправки /
    // правка-удаление / прочитанность; реакции и закрепы — свои репозитории.
    MessagesRepository,
    MessagesWriteRepository,
    MessagesLifecycleRepository,
    MessagesReadStateRepository,
    MessagesReactionsRepository,
    ThreadParticipantsRepository,
    MessagesService,
    MessagesDeleteService,
    MessageActionsService,
    MessagePinsService,
    MessageReactionsService,
    ThreadWatchService,
    MessagePinsRepository,
    AttachmentsRepository,
    AttachmentsService,
    MessageDtoMapper,
    UserProfileProvider,
    { provide: USER_PROFILE_READER, useClass: UserProfileProvider },
    // Превью вложений (#150, ADR-0015): очередь (продюсер), генератор и
    // in-process воркер — первый потребитель BullMQ (REDIS_URL, core/redis).
    ThumbnailQueue,
    ThumbnailService,
    ThumbnailWorker,
    // Стикер-паки (#143): CRUD/установка/загрузка + чтение для отправки.
    StickersRepository,
    StickerPackEvents,
    StickersService,
    // Избранное (#171): личные закладки-ссылки, витрина «Избранного».
    FavoritesRepository,
    FavoriteSourcesRepository,
    FavoriteCardMapper,
    FavoritesService,
    // Витрина беседы (#211): серверные списки вложений/ссылок панели
    // «О чате» + денормализованные счётчики (Δ в транзакциях состава).
    VaultRepository,
    VaultWriteRepository,
    VaultService,
    // Превью ссылок (#212, ADR-0018): кэш + очередь + воркер (linkpeek за
    // SSRF-гвардами) + слушатель message_sent/edited (ленивый прогрев).
    LinkPreviewRepository,
    LinkPreviewQueue,
    LinkPreviewRateLimiter,
    LinkPreviewService,
    LinkPreviewWorker,
    MessageLinksPreviewHandler,
    MessageEditedPreviewHandler,
    // Политика важных (#177): счётчик дневного лимита для попапа молнии.
    UrgentPolicyReader,
    // Мост версий файлов в беседы (#182): file.version_created →
    // chat.attachment_updated (маршрутизация gateway'ем в conv-комнаты).
    FileVersionHandler,
    // Чат задачи (#252): беседа type=task, состав = участники задачи.
    TaskChatRepository,
    TaskChatService,
    TaskChatSyncRunner,
    // Блок перехода задачи в ленте (#380): kind='task_transition'.
    TaskTransitionBlockService,
    TaskTransitionBlockHandler,
    // Блоки отметок сбора (#434): kind='task_press' — сдача/возврат.
    TaskPressBlockService,
    TaskPressSubmittedBlockHandler,
    TaskPressReturnedBlockHandler,
    TaskCreatedChatHandler,
    TaskAssignedChatHandler,
    TaskParticipantsChatHandler,
    TaskDeletedChatHandler,
    TaskUpdatedChatHandler,
    // Канал проекта (#52, Р8): беседа type=project_channel, состав =
    // участники проекта, пост — руководство + project.channel.post.
    ProjectChatRepository,
    ProjectChatService,
    ProjectChatHandlers,
    ProjectChatHandlerRunner,
    ProjectCreatedChatHandler,
    ProjectParticipantsChatHandler,
    ProjectRosterSyncedChatHandler,
    ProjectUpdatedChatHandler,
    // Чат письма (#55, Р10): беседа type=letter, состав = адресат + участники.
    LetterChatRepository,
    LetterChatService,
    LetterChatSyncRunner,
    // Блок перехода письма в ленте: kind='letter_transition'.
    LetterTransitionBlockService,
    LetterTransitionBlockHandler,
    LetterRegisteredChatHandler,
    LetterParticipantsChatHandler,
    LetterDeletedChatHandler,
    LetterUpdatedChatHandler,
  ],
})
export class ChatModule {}
