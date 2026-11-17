import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ASSISTANT_LIMITS, ErrorCode, type AssistantAction } from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import { AuditRepository } from '../../core/audit/audit.repository.js';
import { AssistantRepository, type ActionRow } from './assistant.repository.js';
import { toActionDto } from './assistant.serializers.js';
import { RunBusService } from './run-bus.service.js';
import { findAnyTool } from './tools/catalog.js';
import { ToolExecutorService, parseToolInput } from './tools/tool-executor.service.js';
import type {
  AssistantToolDefinition,
  ToolActionField,
  ToolContext,
} from './tools/tool-definition.js';

/** Сколько «выполняется» до признания захвата зависшим (перезапуск API). */
const STALE_EXECUTING_MS = 60_000;

/** Потолок краткого результата карточки (как у строки вызова в ленте). */
const RESULT_PREVIEW_CHARS = 600;

/** Предложение действия из прогона: всё, что нужно карточке. */
export interface ActionProposal {
  runId: string;
  sessionId: string;
  messageId: string | null;
  userId: string;
  tool: AssistantToolDefinition;
  rawInput: unknown;
  /** Байпас прогона: карточка сразу исполняется (ADR-0048). */
  automatic: boolean;
  authorization: string;
  /** Контекст инструмента (экран, отмена, чтение имён для полей). */
  ctx: ToolContext;
}

/**
 * Карточки действий (Ф2, ADR-0048): единственный путь записи в портал.
 *
 * `propose` вызывается агентомным циклом на `kind: write` — он НЕ пишет в
 * портал, а создаёт карточку. Запись выполняет `execute` (кнопка
 * «Выполнить») либо сам цикл при байпасе (`automatic`), и всегда от имени
 * сотрудника: тот же `Authorization`, те же guard-ы, `Idempotency-Key` =
 * id карточки (повторный клик не создаёт дубль).
 */
@Injectable()
export class AssistantActionsService {
  constructor(
    private readonly repo: AssistantRepository,
    private readonly executor: ToolExecutorService,
    private readonly bus: RunBusService,
    private readonly audit: AuditRepository,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AssistantActionsService.name);
  }

  /** Создать карточку (и при байпасе — сразу выполнить). Текст — для модели. */
  async propose(proposal: ActionProposal): Promise<{ text: string; action: ActionRow | null }> {
    const { tool, ctx } = proposal;
    if (tool.kind !== 'write' || !tool.card) {
      return {
        text: 'Ошибка (ASSISTANT_TOOL_INVALID): инструмент не является действием',
        action: null,
      };
    }
    // Быстрая проверка до чтения имён/сборки карточки; окончательную держит
    // атомарная вставка ниже (параллельные write-вызовы шага).
    const count = await this.repo.countRunActions(proposal.runId);
    if (count >= ASSISTANT_LIMITS.maxActionsPerRun) {
      return { text: tooManyActionsText(), action: null };
    }
    const parsed = parseToolInput(tool, proposal.rawInput);
    if (!parsed.ok) {
      return {
        text: `Ошибка (${parsed.error.errorCode}): ${parsed.error.message}`,
        action: null,
      };
    }

    // Карточка собирается из человеческих значений: имена по id дочитываются
    // от имени сотрудника; недоступное имя не валит карточку (id как есть).
    const { summary, fields } = await buildCard(tool, parsed.input, ctx);
    const row = await this.repo.createActionWithinLimit(
      {
        runId: proposal.runId,
        messageId: proposal.messageId,
        userId: proposal.userId,
        toolId: tool.id,
        title: tool.card.title,
        summary,
        fields,
        consequences: tool.card.consequences,
        undoable: Boolean(tool.card.undo),
        automatic: proposal.automatic,
        args: parsed.input,
      },
      ASSISTANT_LIMITS.maxActionsPerRun,
    );
    if (!row) return { text: tooManyActionsText(), action: null };
    // Пачка (#916): карточки одного хода решаются вместе, продолжение —
    // после всех. Байпас в пачку не входит: действия уже выполнены.
    if (!proposal.automatic && proposal.messageId) {
      await this.repo.ensureActionBatch({
        messageId: proposal.messageId,
        sessionId: proposal.sessionId,
        runId: proposal.runId,
        userId: proposal.userId,
      });
    }
    await this.publish(proposal.runId, 'action.proposed', row);

    if (!proposal.automatic) {
      return {
        text: `Действие подготовлено и ждёт подтверждения сотрудника: ${summary}. Карточка уже в ленте — не вызывай инструмент повторно и не утверждай, что действие выполнено.`,
        action: row,
      };
    }
    const done = await this.run(row, proposal.authorization);
    return { text: describeOutcome(done), action: done };
  }

  /** Подтверждение сотрудника: выполнить карточку (чужая — 404). */
  async execute(userId: string, id: string, authorization: string): Promise<AssistantAction> {
    const row = await this.repo.findAction(userId, id);
    if (!row) throw DomainException.notFound('Действие не найдено');
    return toActionDto(await this.run(row, authorization));
  }

  /** Отказ сотрудника: карточка закрывается, записей в портале нет. */
  async cancel(userId: string, id: string): Promise<AssistantAction> {
    const row = await this.repo.findAction(userId, id);
    if (!row) throw DomainException.notFound('Действие не найдено');
    if (row.state === 'cancelled') return toActionDto(row);
    if (row.state !== 'proposed' && row.state !== 'failed') {
      throw new DomainException(ErrorCode.CONFLICT, 'Действие уже выполнено или отменено');
    }
    const claimed = await this.repo.claimAction(id, ['proposed', 'failed'], 'cancelled');
    if (!claimed) throw new DomainException(ErrorCode.CONFLICT, 'Действие уже изменено');
    const updated = (await this.repo.findAction(userId, id)) ?? row;
    await this.publish(row.runId, 'action.cancelled', updated);
    return toActionDto(updated);
  }

  /** Отмена выполненного (где API позволяет): удаляем созданное. */
  async undo(userId: string, id: string, authorization: string): Promise<AssistantAction> {
    const row = await this.repo.findAction(userId, id);
    if (!row) throw DomainException.notFound('Действие не найдено');
    if (row.state === 'undone') return toActionDto(row);
    if (row.state !== 'executed') {
      throw new DomainException(ErrorCode.CONFLICT, 'Отменить можно только выполненное действие');
    }
    const tool = findAnyTool(row.toolId);
    const request = tool?.card?.undo?.(asInput(row.args), row.resultData);
    if (!tool?.card?.undo || !request) {
      throw new DomainException(ErrorCode.CONFLICT, 'Это действие нельзя отменить');
    }
    if (!(await this.repo.claimAction(row.id, ['executed'], 'executing'))) {
      // Упавший посреди отмены процесс оставил `executing`: через минуту
      // захват переигрывается, иначе карточка застряла бы навсегда.
      const current = await this.repo.findAction(userId, id);
      const stale =
        current?.state === 'executing' &&
        Date.now() - current.updatedAt.getTime() > STALE_EXECUTING_MS;
      if (!stale || !(await this.repo.claimAction(row.id, ['executing'], 'executing'))) {
        throw new DomainException(ErrorCode.CONFLICT, 'Действие уже изменяется');
      }
    }
    const execution = await this.executor.executeUndo(request, authorization, `${row.id}:undo`);
    if (!execution.ok) {
      // Не смогли удалить — карточка остаётся выполненной, но с причиной.
      const failed = await this.repo.finishAction(row.id, {
        state: 'executed',
        errorCode: execution.errorCode,
      });
      return toActionDto(failed ?? row);
    }
    const updated = await this.repo.finishAction(row.id, {
      state: 'undone',
      undoneAt: new Date(),
      errorCode: null,
    });
    const dto = toActionDto(updated ?? row);
    await this.publish(row.runId, 'action.undone', updated ?? row);
    return dto;
  }

  /** Исполнение карточки: захват состояния → API → фиксация и событие. */
  private async run(row: ActionRow, authorization: string): Promise<ActionRow> {
    // Идемпотентность: повторный клик получает уже выполненную карточку.
    if (row.state === 'executed' || row.state === 'undone' || row.state === 'cancelled') {
      return row;
    }
    if (!(await this.claimExecuting(row))) {
      const current = await this.repo.findAction(row.userId, row.id);
      if (current) return current;
      throw new DomainException(ErrorCode.CONFLICT, 'Действие уже выполняется');
    }

    const tool = findAnyTool(row.toolId);
    const execution =
      tool && tool.kind === 'write'
        ? await this.executor.executeWrite(tool, row.args, authorization, row.id)
        : {
            ok: false as const,
            errorCode: 'ASSISTANT_TOOL_INVALID',
            message: 'Действие недоступно',
          };

    if (execution.ok) {
      const updated = await this.repo.finishAction(row.id, {
        state: 'executed',
        resultData: execution.data ?? null,
        resultPreview: clipPreview(execution.text),
        href: execution.entity?.href ?? null,
        hrefLabel: execution.entity?.label ?? null,
        errorCode: null,
        executedAt: new Date(),
      });
      const done = updated ?? row;
      await this.auditAction(done, true);
      await this.publish(row.runId, 'action.executed', done);
      return done;
    }

    this.logger.warn(
      { actionId: row.id, toolId: row.toolId, code: execution.errorCode },
      'Assistant action failed',
    );
    const failed = await this.repo.finishAction(row.id, {
      state: 'failed',
      resultPreview: clipPreview(execution.message),
      errorCode: execution.errorCode,
    });
    const done = failed ?? row;
    await this.auditAction(done, false);
    await this.publish(row.runId, 'action.failed', done);
    return done;
  }

  /**
   * Аудит действия «через ИИ» (I7): автор — сотрудник, в деталях — карточка
   * и пометка автоматического исполнения. Пишется и при кнопке, и при
   * байпасе (там HTTP-маршрута нет — интерсептор аудита не сработает).
   */
  private async auditAction(row: ActionRow, ok: boolean): Promise<void> {
    await this.audit
      .append({
        actorId: row.userId,
        action: ok ? 'assistant.action_execute' : 'assistant.action_failed',
        entityType: 'assistant_action',
        entityId: row.id,
        details: {
          viaAi: true,
          toolId: row.toolId,
          automatic: row.automatic,
          runId: row.runId,
          errorCode: row.errorCode,
        },
      })
      .catch((error: unknown) => this.logger.error({ err: error }, 'Action audit failed'));
  }

  /** Атомарный захват: proposed/failed → executing; зависший захват — повторно. */
  private async claimExecuting(row: ActionRow): Promise<boolean> {
    if (await this.repo.claimAction(row.id, ['proposed', 'failed'], 'executing')) return true;
    if (row.state !== 'executing') return false;
    const stale = Date.now() - row.updatedAt.getTime() > STALE_EXECUTING_MS;
    return stale ? this.repo.claimAction(row.id, ['executing'], 'executing') : false;
  }

  private async publish(
    runId: string,
    type:
      | 'action.proposed'
      | 'action.executed'
      | 'action.cancelled'
      | 'action.failed'
      | 'action.undone',
    row: ActionRow,
  ): Promise<void> {
    await this.bus.publish(runId, type, { action: toActionDto(row) } as Record<string, unknown>);
  }
}

/** Сборка карточки: сбой дочитывания имени не мешает подтверждению. */
async function buildCard(
  tool: AssistantToolDefinition,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ summary: string; fields: ToolActionField[] }> {
  const card = tool.card!;
  let summary: string;
  try {
    summary = await card.summary(input, ctx);
  } catch {
    summary = card.title;
  }
  let fields: ToolActionField[];
  try {
    fields = await card.fields(input, ctx);
  } catch {
    fields = [];
  }
  return {
    summary: clipText(summary, 600),
    fields: fields
      .filter((field) => field.label.trim() && field.value.trim())
      .slice(0, 24)
      .map((field) => ({
        label: clipText(field.label, 60),
        value: clipText(field.value, 600),
      })),
  };
}

/** Текст исхода для модели: выполнено или причина отказа. */
/** Текст модели при исчерпанном лимите карточек прогона (ранний и атомарный). */
function tooManyActionsText(): string {
  return `Ошибка (ASSISTANT_TOO_MANY_ACTIONS): за прогон можно предложить не больше ${ASSISTANT_LIMITS.maxActionsPerRun} действий — объясни сотруднику план и попроси уточнить`;
}

function describeOutcome(row: ActionRow): string {
  if (row.state === 'executed') {
    return `Действие выполнено (карточка ${row.id}): ${row.resultPreview ?? row.title}`;
  }
  return `Ошибка (${row.errorCode ?? 'ASSISTANT_ACTION_FAILED'}): ${row.resultPreview ?? 'действие не выполнено'}`;
}

function asInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clipText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** Краткий результат: строки сохраняются — карточка показывает построчно. */
function clipPreview(text: string): string {
  const lines = text.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trimEnd());
  const clipped = lines.slice(0, 10).join('\n').trim();
  return clipText(clipped, RESULT_PREVIEW_CHARS);
}
