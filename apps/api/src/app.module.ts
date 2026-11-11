import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditModule } from './core/audit/audit.module.js';
import { CryptoModule } from './core/crypto/crypto.module.js';
import { DatabaseModule } from './core/database/database.module.js';
import { DomainExceptionFilter } from './core/errors/domain-exception.filter.js';
import { EventsModule } from './core/events/events.module.js';
import { FeatureFlagsModule } from './core/feature-flags/feature-flags.module.js';
import { FeatureFlagGuard } from './core/guards/feature-flag.guard.js';
import { PermissionGuard } from './core/guards/permission.guard.js';
import { AuditInterceptor } from './core/interceptors/audit.interceptor.js';
import { IdempotencyInterceptor } from './core/interceptors/idempotency.interceptor.js';
import { LoggingModule } from './core/logging/logging.module.js';
import { RedisModule } from './core/redis/redis.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard.js';
import { ChatFileAccessModule } from './modules/chat/file-access/chat-file-access.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { CorrespondenceModule } from './modules/correspondence/correspondence.module.js';
import { CrmModule } from './modules/crm/crm.module.js';
import { CustomFieldsModule } from './modules/custom-fields/custom-fields.module.js';
import { DictionariesModule } from './modules/dictionaries/dictionaries.module.js';
import { DirectoryModule } from './modules/directory/directory.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PreferencesModule } from './modules/preferences/preferences.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { DesktopModule } from './modules/desktop/desktop.module.js';
import { HomeModule } from './modules/home/home.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { WorkflowsModule } from './modules/workflows/workflows.module.js';

@Module({
  imports: [
    LoggingModule,
    DatabaseModule,
    RedisModule,
    CryptoModule,
    EventsModule,
    FeatureFlagsModule,
    AuditModule,
    HealthModule,
    AuthModule,
    FilesModule,
    ChatModule,
    // Права chat на файлы для движка просмотра (#138, I13): @Global-мост
    // Права файлов — реестр FileAccessRegistry (files) находит контрибьютора
    // по маркеру fileAccessContext; ChatFileAccessModule — после ChatModule.
    ChatFileAccessModule,
    DirectoryModule,
    // Справочники (#54): бизнес-списки как данные (I15), модуль ядра.
    DictionariesModule,
    // CRM (#460, ADR-0033): контрагенты и контактные лица — master-данные,
    // на которые ссылаются письма (#55) и проекты (#52); за флагом `crm`.
    CrmModule,
    CorrespondenceModule,
    // Реестр кастомных атрибутов (#431, ADR-0029): ядро без флага —
    // атрибуты нужны карточкам, фильтрам и окнам переходов задач.
    CustomFieldsModule,
    // Уведомления (#100): журнал + ярусы; читает состав бесед read-портом
    // чата (ChatPortsModule внутри), подписан на события chat.*.
    NotificationsModule,
    // Личные настройки интерфейса (#745): навигация и раскладка карточек
    // сотрудника; ядро без флага — нужны каждой карточке.
    PreferencesModule,
    HomeModule,
    // Проекты (#52, ADR-0030): проект-договор и «темы», двухрежимное
    // участие, типы, портфели, настройки портала; за флагом `projects`.
    ProjectsModule,
    // «Процессы» (#428, ADR-0024): типы процессов, маршруты, редактор,
    // публикация, общий движок; ядро — фичефлага нет (I10).
    WorkflowsModule,
    // Задачи (#37): самостоятельные задачи; движок маршрутов — в workflows,
    // задачи подключаются адаптером сущности (ADR-0024).
    TasksModule,
    // Десктоп-оболочка (#254): публичный конфиг для тонкого клиента.
    DesktopModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    // Порядок guard-ов: аутентификация (401) → права (403) → фичефлаг (404).
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: FeatureFlagGuard },
    // Порядок интерсепторов: идемпотентность внешний (replay не плодит аудит),
    // аудит внутренний (пишет только реально исполненные действия).
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
