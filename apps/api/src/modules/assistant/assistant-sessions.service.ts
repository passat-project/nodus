import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@nodus/contracts';
import {
  ASSISTANT_LIMITS,
  ErrorCode,
  type AssistantContext,
  type AssistantMessageList,
  type AssistantSession,
  type AssistantSessionList,
  type CreateAssistantSessionBody,
  type SendAssistantMessageBody,
  type SendAssistantMessageResponse,
  type UpdateAssistantSessionBody,
} from '@nodus/contracts';

import { FeatureFlagService } from '../../core/feature-flags/feature-flag.service.js';
import { DomainException } from '../../core/errors/domain-exception.js';
import { AgentRunnerService } from './agent/agent-runner.service.js';
import { AssistantRepository } from './assistant.repository.js';
import { toMessageDto, toSessionDto } from './assistant.serializers.js';
import type { ScreenContext } from './tools/tool-definition.js';

/** Раздел портала в контексте: id из nav-registry (латиница, короткий). */
const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * Сессии и отправка сообщений (ADR-0043 п. 6): доступ только к своим
 * диалогам (чужая сессия — 404, существование не раскрываем).
 *
 * `POST` сообщения создаёт запись сотрудника и прогон, отвечает 202 —
 * генерация идёт асинхронно, поток отдаётся отдельным SSE-маршрутом.
 */
@Injectable()
export class AssistantSessionsService {
  constructor(
    private readonly repo: AssistantRepository,
    private readonly runner: AgentRunnerService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  async list(user: AuthUser): Promise<AssistantSessionList> {
    const rows = await this.repo.listSessions(user.id, ASSISTANT_LIMITS.maxSessions);
    return { items: rows.map(toSessionDto), nextCursor: null };
  }

  async create(user: AuthUser, body: CreateAssistantSessionBody): Promise<AssistantSession> {
    const row = await this.repo.createSession(user.id, body.title?.trim() ?? '');
    return toSessionDto(row);
  }

  async update(
    user: AuthUser,
    id: string,
    body: UpdateAssistantSessionBody,
  ): Promise<AssistantSession> {
    const row = await this.repo.updateSession(user.id, id, body);
    if (!row) throw DomainException.notFound('Диалог не найден');
    return toSessionDto(row);
  }

  async messages(user: AuthUser, id: string): Promise<AssistantMessageList> {
    const session = await this.repo.findSession(user.id, id);
    if (!session) throw DomainException.notFound('Диалог не найден');
    const rows = await this.repo.listMessages(id, 200);
    return { items: rows.map(toMessageDto), nextCursor: null };
  }

  /**
   * Отправить сообщение: создаём вопрос сотрудника и прогон, запускаем цикл
   * без ожидания и отвечаем `202 { runId, messageId }`.
   */
  async sendMessage(
    user: AuthUser,
    id: string,
    body: SendAssistantMessageBody,
    authorization: string,
  ): Promise<SendAssistantMessageResponse> {
    const session = await this.repo.findSession(user.id, id);
    if (!session) throw DomainException.notFound('Диалог не найден');
    if (session.archivedAt) {
      throw new DomainException(ErrorCode.CONFLICT, 'Диалог в архиве: отправка недоступна');
    }

    const text = body.text.trim();
    const screen = normalizeScreenContext(body.context);
    const runId = randomUUID();
    await this.repo.createRun({
      id: runId,
      sessionId: id,
      userId: user.id,
      providerId: null,
      modelId: null,
    });
    const message = await this.repo.createMessage({
      sessionId: id,
      runId,
      role: 'user',
      text,
    });
    // Заголовок сессии — первый вопрос (как в чатах): пустая сессия получает его.
    await this.repo.touchSession(
      id,
      message.createdAt,
      session.title.trim() ? undefined : titleFrom(text),
    );

    const features = await this.featureFlags.enabledModules();
    this.runner.start({
      runId,
      sessionId: id,
      userId: user.id,
      authorization,
      permissions: user.permissions,
      features,
      screen,
    });
    return { runId, messageId: message.id };
  }
}

/** Заголовок сессии из первого вопроса: одна строка, до 80 знаков. */
function titleFrom(text: string): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > 80 ? `${single.slice(0, 77)}…` : single;
}

/**
 * Контекст экрана от клиента: не доверяем форме — мусор в разделе
 * отбрасывается, id карточки принимается только вместе с видом.
 */
export function normalizeScreenContext(context?: AssistantContext): ScreenContext {
  const moduleId =
    context?.moduleId && MODULE_ID_PATTERN.test(context.moduleId) ? context.moduleId : null;
  const cardKind = context?.cardKind ?? null;
  const cardId = cardKind && context?.cardId ? context.cardId : null;
  return { moduleId, cardKind: cardId ? cardKind : null, cardId };
}
