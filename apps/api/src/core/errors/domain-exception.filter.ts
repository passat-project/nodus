import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { ZodError } from 'zod';
import { ErrorCode, type ApiErrorResponse } from '@nodus/contracts';

import { Prisma } from '../../generated/prisma/client.js';
import { DomainException } from './domain-exception.js';

/** Единый текст 5xx наружу: реальные детали — только в лог (api-conventions, I7; #538). */
const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/** HTTP-статус для системного кода (канон формата — api-conventions.md). */
const CODE_TO_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  [ErrorCode.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  // Системные коды фреймворк-ошибок (#535): лимит multipart/bodyLimit — 413;
  // чужой content-type у JSON-маршрута — 415.
  [ErrorCode.PAYLOAD_TOO_LARGE]: HttpStatus.PAYLOAD_TOO_LARGE,
  [ErrorCode.UNSUPPORTED_MEDIA_TYPE]: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  // Доменные коды с нестандартным статусом (остальные доменные → 400 ниже).
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.AUTH_SESSION_INVALID]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.DIRECTORY_EMAIL_TAKEN]: HttpStatus.CONFLICT,
  // Ссылка оргструктуры (руководитель/подразделение/должность) негодна — 400
  // с details { field, reason } (#441).
  [ErrorCode.DIRECTORY_REFERENCE_INVALID]: HttpStatus.BAD_REQUEST,
  // Удаление единственной личной стадии «Моего плана» — конфликт состояния.
  [ErrorCode.TASK_LAST_STAGE]: HttpStatus.CONFLICT,
  // Маршрут задачи (ADR-0020): переход недоступен / гейт не пройден — конфликт
  // состояния (запрос корректен, задача сейчас так не ходит).
  [ErrorCode.WORKFLOW_TRANSITION_NOT_ALLOWED]: HttpStatus.CONFLICT,
  [ErrorCode.WORKFLOW_TRANSITION_BLOCKED]: HttpStatus.CONFLICT,
  // Окно перехода (#380): состав введённого не совпал с настройкой — 422.
  [ErrorCode.WORKFLOW_TRANSITION_FORM_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.WORKFLOW_OVERRIDE_REASON_REQUIRED]: HttpStatus.BAD_REQUEST,
  // Нумерация (#55, Р2): у типа нет серии — конфликт конфигурации.
  [ErrorCode.WORKFLOW_NUMBERING_NOT_CONFIGURED]: HttpStatus.CONFLICT,
  [ErrorCode.TASK_PARENT_CYCLE]: HttpStatus.CONFLICT,
  [ErrorCode.TASK_TIMER_NOT_RUNNING]: HttpStatus.CONFLICT,
  // Вложения (#57, ADR-0013): лимит файла чата — 413; переполнение трея и
  // несовпадение размера — 400; карантин — 410 (файл был, больше не отдаётся).
  [ErrorCode.CHAT_ATTACHMENT_TOO_LARGE]: HttpStatus.PAYLOAD_TOO_LARGE,
  [ErrorCode.CHAT_ATTACHMENT_TOO_MANY]: HttpStatus.BAD_REQUEST,
  // Файл стикера не прошёл magic bytes/лимит (#143): формат — 400 (выбор
  // файла), превышение размера — отдельно переводится в 413 в сервисе.
  [ErrorCode.CHAT_STICKER_INVALID]: HttpStatus.BAD_REQUEST,
  // Аватар не прошёл проверку (#186): формат — 400; превышение 10 МБ —
  // отдельно переводится в 413 в сервисе.
  [ErrorCode.FILE_AVATAR_INVALID]: HttpStatus.BAD_REQUEST,
  // «Важные сообщения» (#100): лимит и потолок группы — конфликт политики
  // (не валидация поля: значение корректно, действовать нельзя).
  [ErrorCode.CHAT_URGENT_LIMIT_EXCEEDED]: HttpStatus.CONFLICT,
  [ErrorCode.CHAT_URGENT_GROUP_TOO_LARGE]: HttpStatus.CONFLICT,
  // Лимит участников беседы (#186): значение корректно, действовать нельзя —
  // конфликт политики, но 400 читается понятнее в API-клиенте.
  [ErrorCode.CHAT_MEMBERS_LIMIT_REACHED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.FILE_SIZE_MISMATCH]: HttpStatus.BAD_REQUEST,
  [ErrorCode.FILE_QUARANTINED]: HttpStatus.GONE,
  // Офисный просмотр (#138): движок выключен — 503 (не ошибка клиента, деградация),
  // неподдерживаемый формат и превышение потолка — 400 (выбор файла).
  [ErrorCode.FILE_OFFICE_DISABLED]: HttpStatus.SERVICE_UNAVAILABLE,
  [ErrorCode.FILE_OFFICE_UNSUPPORTED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.FILE_OFFICE_TOO_LARGE]: HttpStatus.PAYLOAD_TOO_LARGE,
  // Редактор маршрутов (#378, ADR-0021): конфликт версии — 409; невалидный
  // документ и обязательный перенос — 422 (семантика документа, не поля);
  // блокировки системного типа и занятое имя — 409.
  [ErrorCode.WORKFLOW_VERSION_CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.WORKFLOW_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.WORKFLOW_MIGRATION_REQUIRED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.PROCESS_TYPE_SYSTEM_LOCKED]: HttpStatus.CONFLICT,
  [ErrorCode.PROCESS_TYPE_NAME_TAKEN]: HttpStatus.CONFLICT,
  // Типы процессов (#432): доступ к типу — 403; не хватает обязательных при
  // создании полей и негодное скрытое значение — 422 (семантика запроса);
  // привязка атрибута к чужому типу — 422.
  [ErrorCode.PROCESS_TYPE_FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.PROCESS_TYPE_FIELDS_REQUIRED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.PROCESS_TYPE_PRESET_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.CUSTOM_FIELD_BINDING_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  // CRM (#460): занятый УНП и мутация архивного контрагента — конфликт
  // состояния (запрос корректен, запись сейчас так менять нельзя).
  [ErrorCode.CRM_UNP_TAKEN]: HttpStatus.CONFLICT,
  [ErrorCode.CRM_COUNTERPARTY_ARCHIVED]: HttpStatus.CONFLICT,
  // Удаление связанного контрагента — конфликт состояния (архив вместо удаления).
  [ErrorCode.CRM_COUNTERPARTY_IN_USE]: HttpStatus.CONFLICT,
  [ErrorCode.CRM_CONTACT_IN_USE]: HttpStatus.CONFLICT,
  // Письма (#55): повторная регистрация, удаление/правка не в том состоянии —
  // конфликт состояния; негодный ввод регистрации — 422 (семантика значения).
  [ErrorCode.LETTER_ALREADY_REGISTERED]: HttpStatus.CONFLICT,
  [ErrorCode.LETTER_REGISTRATION_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.LETTER_NOT_DELETABLE]: HttpStatus.CONFLICT,
  [ErrorCode.LETTER_NOT_EDITABLE]: HttpStatus.CONFLICT,
  // Подтверждение связи «ответ на» (#56) — негодное значение, не конфликт.
  [ErrorCode.LETTER_RELATION_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  // Кастомные поля (#431, ADR-0029): невалидное значение и недоступный тип —
  // 422 (семантика значения, не форма запроса); имя, лимит, архивное поле и
  // несовместимая смена типа — конфликт состояния; справочники — конфликт.
  [ErrorCode.CUSTOM_FIELD_VALUE_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.CUSTOM_FIELD_TYPE_UNAVAILABLE]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.CUSTOM_FIELD_NAME_TAKEN]: HttpStatus.CONFLICT,
  [ErrorCode.CUSTOM_FIELD_TYPE_CHANGE_INCOMPATIBLE]: HttpStatus.CONFLICT,
  [ErrorCode.CUSTOM_FIELD_LIMIT_REACHED]: HttpStatus.CONFLICT,
  [ErrorCode.PROJECT_FIELDS_REQUIRED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.DICTIONARY_SYSTEM_LOCKED]: HttpStatus.CONFLICT,
  [ErrorCode.DICTIONARY_ITEM_NAME_TAKEN]: HttpStatus.CONFLICT,
  // Права доступа модулей (#379, ADR-0034): неизменяемая роль администратора —
  // конфликт состояния; выдача права, которого нет у актора, — запрет.
  [ErrorCode.ROLE_LOCKED]: HttpStatus.CONFLICT,
  [ErrorCode.ROLE_PERMISSION_NOT_HELD]: HttpStatus.FORBIDDEN,
  [ErrorCode.ROLE_LAST_ADMIN]: HttpStatus.CONFLICT,
  // Дерево проекта (#467): негодный узел (не найден/чужой проект/не тот
  // проект задачи) — 422 без оракула; цикл переноса, непустой узел, занятый
  // шифр, лимит структуры и архивный вид/занятое имя вида — конфликт
  // состояния (запрос корректен, действовать сейчас нельзя).
  [ErrorCode.PROJECT_NODE_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.PROJECT_NODE_CYCLE]: HttpStatus.CONFLICT,
  [ErrorCode.PROJECT_NODE_NOT_EMPTY]: HttpStatus.CONFLICT,
  [ErrorCode.PROJECT_NODE_CODE_TAKEN]: HttpStatus.CONFLICT,
  [ErrorCode.PROJECT_NODE_LIMIT_REACHED]: HttpStatus.CONFLICT,
  [ErrorCode.PROJECT_NODE_KIND_ARCHIVED]: HttpStatus.CONFLICT,
  [ErrorCode.PROJECT_NODE_KIND_NAME_TAKEN]: HttpStatus.CONFLICT,
  // Обязательные поля формы вида и негодная форма — 422 (как
  // PROCESS_TYPE_FIELDS_REQUIRED): запрос неполон/неверен, а не конфликтует
  // с состоянием (#556).
  [ErrorCode.PROJECT_NODE_FIELDS_REQUIRED]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.PROJECT_NODE_KIND_FORM_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ErrorCode.PROJECT_TYPE_FORM_INVALID]: HttpStatus.UNPROCESSABLE_ENTITY,
  // Вид не входит в допустимые виды типа проекта — 422 (как not_in_type
  // атрибутов): запрос корректен, но вид этому типу не назначен (#556).
  [ErrorCode.PROJECT_NODE_KIND_NOT_ALLOWED]: HttpStatus.UNPROCESSABLE_ENTITY,
};

/** Код для HTTP-исключений Nest/Fastify (400 у нас — всегда валидация входа). */
const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  // Фреймворк/плагины Fastify (#535): лимит multipart/bodyLimit и чужой
  // content-type — до этого уходили в фолбэк VALIDATION_FAILED, и статус
  // противоречил коду в теле ответа.
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
};

/**
 * Глобальный фильтр: любая ошибка → единый `{ code, message, details?, traceId }`.
 * DomainException маппится по коду (доменные `MODULE_REASON` по умолчанию → 400),
 * непредвиденное → 500 INTERNAL_ERROR без деталей наружу (error-details safety).
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(DomainExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    const traceId = String(request.id);

    const { status, body } = this.toResponse(exception, traceId);
    void reply.status(status).send(body);
  }

  /** Известные ошибки Prisma → безопасные коды контракта (без SQL наружу). */
  private fromPrismaError(
    exception: InstanceType<typeof Prisma.PrismaClientKnownRequestError>,
    traceId: string,
  ): { status: number; body: ApiErrorResponse } {
    this.logger.warn({ traceId, prismaCode: exception.code }, exception.message);
    switch (exception.code) {
      case 'P2002': // уникальное ограничение
        return {
          status: HttpStatus.CONFLICT,
          body: {
            code: ErrorCode.CONFLICT,
            message: 'A record with this value already exists',
            details: { fields: (exception.meta?.target as string[]) ?? [] },
            traceId,
          },
        };
      case 'P2025': // запись не найдена
        return {
          status: HttpStatus.NOT_FOUND,
          body: { code: ErrorCode.NOT_FOUND, message: 'Record not found', traceId },
        };
      case 'P2003': // FK-ограничение
        return {
          status: HttpStatus.BAD_REQUEST,
          body: {
            code: ErrorCode.VALIDATION_FAILED,
            message: 'Referenced record does not exist',
            traceId,
          },
        };
      default:
        this.logger.error({ traceId, err: exception }, 'Unhandled Prisma error');
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          body: {
            code: ErrorCode.INTERNAL_ERROR,
            message: INTERNAL_ERROR_MESSAGE,
            traceId,
          },
        };
    }
  }

  /** Ошибка Fastify-плагина: объект со числовым statusCode (не Nest HttpException). */
  private isFastifyError(exception: unknown): exception is { statusCode: number; message: string } {
    return (
      typeof exception === 'object' &&
      exception !== null &&
      !(exception instanceof HttpException) &&
      'statusCode' in exception &&
      typeof (exception as { statusCode: unknown }).statusCode === 'number' &&
      (exception as { statusCode: number }).statusCode >= 400 &&
      (exception as { statusCode: number }).statusCode < 600
    );
  }

  private toResponse(
    exception: unknown,
    traceId: string,
  ): { status: number; body: ApiErrorResponse } {
    if (exception instanceof DomainException) {
      const status =
        exception.httpStatus ??
        CODE_TO_STATUS[exception.code as ErrorCode] ??
        HttpStatus.BAD_REQUEST; // доменные MODULE_REASON по умолчанию — 400
      this.logger.warn(
        { traceId, code: exception.code, details: exception.details },
        exception.message,
      );
      return {
        status,
        body: {
          code: exception.code,
          message: exception.message,
          ...(exception.details ? { details: exception.details } : {}),
          traceId,
        },
      };
    }

    if (exception instanceof ZodError) {
      // Защитная ветка: канон — ZodValidationPipe бросает DomainException сам,
      // но «голый» ZodError с границы тоже маппим в единый формат.
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          code: ErrorCode.VALIDATION_FAILED,
          message: 'Validation failed',
          details: {
            issues: exception.issues.map((issue) => ({
              path: issue.path.join('.'),
              code: issue.code,
              message: issue.message,
            })),
          },
          traceId,
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaError(exception, traceId);
    }

    // Ошибки Fastify-плагинов (например @fastify/rate-limit): не Nest-исключения,
    // но несут statusCode — маппим в единый формат, а не в 500. Для 5xx наружу
    // только единый текст: message плагина может содержать внутренности (#538).
    if (this.isFastifyError(exception)) {
      const status = exception.statusCode;
      const serverError = status >= HttpStatus.INTERNAL_SERVER_ERROR;
      const code = serverError
        ? ErrorCode.INTERNAL_ERROR
        : (STATUS_TO_CODE[status] ?? ErrorCode.VALIDATION_FAILED);
      if (serverError) {
        this.logger.error({ traceId, err: exception }, exception.message);
      }
      return {
        status,
        body: {
          code,
          message: serverError ? INTERNAL_ERROR_MESSAGE : exception.message,
          traceId,
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const serverError = status >= HttpStatus.INTERNAL_SERVER_ERROR;
      const code = serverError
        ? ErrorCode.INTERNAL_ERROR
        : (STATUS_TO_CODE[status] ?? ErrorCode.VALIDATION_FAILED);
      if (serverError) {
        this.logger.error({ traceId, err: exception }, exception.message);
      }
      return {
        status,
        body: {
          code,
          message: serverError ? INTERNAL_ERROR_MESSAGE : exception.message,
          traceId,
        },
      };
    }

    // Непредвиденное: детали только в лог, наружу — без внутренностей.
    this.logger.error({ traceId, err: exception }, 'Unhandled exception');
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ErrorCode.INTERNAL_ERROR,
        message: INTERNAL_ERROR_MESSAGE,
        traceId,
      },
    };
  }
}
