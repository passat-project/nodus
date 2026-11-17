import { Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { errorMessages } from '@nodus/contracts';

import { asRecord, finalize, str } from './projections.js';
import type {
  AssistantToolDefinition,
  ToolContext,
  ToolEntity,
  ToolRequest,
} from './tool-definition.js';

/** Ошибка вызова (ok: false) — сужение для карточки и исполнителя. */
export type ToolFailure = { ok: false; errorCode: string; message: string };

/** Итог вызова инструмента: успех с компактным текстом или понятная ошибка. */
export type ToolExecution =
  { ok: true; text: string; entity?: ToolEntity; data?: unknown } | ToolFailure;

/** Потолок одного вызова: локальный inject быстрый, зависание — авария. */
const TOOL_TIMEOUT_MS = 20_000;

const UNREADABLE: ToolExecution = {
  ok: false,
  errorCode: 'ASSISTANT_TOOL_INVALID',
  message: 'Инструмент не исполним',
};

/**
 * Исполнитель инструментов (ADR-0043 п. 2): вызов API портала ОТ ИМЕНИ
 * СОТРУДНИКА через Fastify `inject` с его `Authorization`.
 *
 * Почему inject, а не импорт сервисов модулей: проходят те же guard-ы, права,
 * валидация и фильтры видимости, что и из интерфейса (I2/I3/I8); второй
 * бизнес-логики нет, сервисного токена нет. Ошибка API возвращается модели
 * человеческим текстом — она должна объяснить, а не уронить прогон.
 *
 * Запись (Ф2, ADR-0048) исполняется отдельным входом `executeWrite`: вызов
 * из цикла напрямую невозможен (фьюз ниже), карточка подтверждения —
 * единственный путь, `Idempotency-Key` = id карточки.
 */
@Injectable()
export class ToolExecutorService {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  async execute(
    tool: AssistantToolDefinition,
    rawInput: unknown,
    ctx: ToolContext,
  ): Promise<ToolExecution> {
    // Жёсткий фьюз: чтение идёт потоком, запись — только карточкой.
    if (tool.kind !== 'read') {
      return {
        ok: false,
        errorCode: 'ASSISTANT_WRITE_NEEDS_CONFIRMATION',
        message: 'Действие изменяет данные: нужно подтверждение в карточке',
      };
    }
    // «Стоп» мог нажаться до старта вызова: не тратим запрос впустую.
    if (ctx.signal.aborted) return aborted();

    const parsed = parseToolInput(tool, rawInput);
    if (!parsed.ok) return parsed.error;
    const input = parsed.input;

    if (tool.handler) {
      // Сбой внешнего инструмента (MCP-сервер, сеть, отказ сервера) — это
      // ОШИБКА ВЫЗОВА, а не падение прогона: модель должна увидеть причину и
      // пересказать её сотруднику (находка #901).
      let result: Awaited<ReturnType<NonNullable<typeof tool.handler>>>;
      try {
        result = await tool.handler(input, ctx);
      } catch (error) {
        if (ctx.signal.aborted) return aborted();
        return {
          ok: false,
          errorCode: 'ASSISTANT_TOOL_FAILED',
          message:
            error instanceof Error && error.message ? error.message : 'Действие не выполнено',
        };
      }
      if (ctx.signal.aborted) return aborted();
      return { ok: true, text: finalize(result.text), entity: result.entity };
    }
    if (!tool.api || !tool.build || !tool.project) return UNREADABLE;

    const request = tool.build(input);
    const response = await this.inject(toUrl(request), ctx.authorization, ctx.signal);
    if ('error' in response) return response.error;

    const data = parseBody(response.body);
    if (response.status >= 400) return this.errorOf(response.status, data);
    const result = tool.project(data, input);
    return { ok: true, text: finalize(result.text), entity: result.entity, data };
  }

  /**
   * Выполнение записи (ADR-0048): только из карточки действия или байпаса
   * прогона. Права/валидация — те же guard-ы API портала; идемпотентность
   * держит `Idempotency-Key` = id карточки (повторный клик не создаёт дубль).
   */
  async executeWrite(
    tool: AssistantToolDefinition,
    rawInput: unknown,
    authorization: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ToolExecution> {
    if (tool.kind !== 'write' || !tool.api || !tool.build || !tool.project || !tool.card) {
      return UNREADABLE;
    }
    const parsed = parseToolInput(tool, rawInput);
    if (!parsed.ok) return parsed.error;

    const abort = signal ?? neverAborted();
    const request: ToolRequest = { ...tool.build(parsed.input), method: tool.api.method };
    const response = await this.inject(toUrl(request), authorization, abort, {
      method: request.method ?? 'POST',
      body: request.body,
      idempotencyKey,
    });
    if ('error' in response) return response.error;
    const steps: unknown[] = [parseBody(response.body)];
    if (response.status >= 400) return this.errorOf(response.status, steps[0]);
    // Цепочка записи (find-or-create → отправка): каждый шаг идемпотентен
    // своим ключом, повтор карточки не создаёт второй чат/сообщение.
    let data = steps[0];
    // Максимум три шага: цепочка записи не должна превращаться в сценарий.
    for (let next = tool.followUp?.(data, parsed.input) ?? null; next;) {
      if (steps.length >= 3) break;
      const followResponse = await this.inject(toUrl(next), authorization, abort, {
        method: next.method ?? 'POST',
        body: next.body,
        idempotencyKey: `${idempotencyKey}:${steps.length + 1}`,
      });
      if ('error' in followResponse) return followResponse.error;
      const step = parseBody(followResponse.body);
      if (followResponse.status >= 400) return this.errorOf(followResponse.status, step);
      steps.push(step);
      data = step;
      next = tool.followUp?.(data, parsed.input) ?? null;
    }
    const result = tool.project(data, parsed.input, steps);
    return {
      ok: true,
      text: finalize(result.text),
      entity: result.entity,
      // Карточке (и «Отменить») нужны все шаги: чат — первый, сообщение — второй.
      data: steps.length > 1 ? { steps, result: data } : data,
    };
  }

  /** Запрос отмены выполненного действия (DELETE созданного): 204 — успех. */
  async executeUndo(
    request: ToolRequest,
    authorization: string,
    idempotencyKey: string,
  ): Promise<ToolExecution> {
    const response = await this.inject(toUrl(request), authorization, neverAborted(), {
      method: request.method ?? 'DELETE',
      body: request.body,
      idempotencyKey,
    });
    if ('error' in response) return response.error;
    if (response.status >= 400) return this.errorOf(response.status, parseBody(response.body));
    return { ok: true, text: 'Созданное удалено' };
  }

  /** GET портала от имени сотрудника — дочитывание имён для карточки. */
  async readJson(authorization: string, path: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.inject(`/api/v1${path}`, authorization, signal);
    if ('error' in response || response.status >= 400) return null;
    return parseBody(response.body);
  }

  /** Запрос через Fastify inject: полный конвейер Nest + guard-ы. */
  private async inject(
    url: string,
    authorization: string,
    signal: AbortSignal,
    options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<{ status: number; body: string } | { error: ToolExecution }> {
    const fastify = this.adapterHost.httpAdapter?.getInstance<FastifyInstance>();
    if (!fastify) {
      return {
        error: {
          ok: false,
          errorCode: 'ASSISTANT_TOOL_INVALID',
          message: 'HTTP-конвейер недоступен',
        },
      };
    }
    const call = fastify.inject({
      method: (options.method ?? 'GET') as 'GET',
      url,
      headers: {
        authorization,
        accept: 'application/json',
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      ...(options.body !== undefined ? { payload: options.body as object } : {}),
      // Отмена прогона рвёт и запрос в API, а не только поток провайдера.
      signal,
    });
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), TOOL_TIMEOUT_MS).unref?.(),
    );
    // Отмена — отдельный исход: не «ошибка инструмента», а остановка прогона.
    const abortedPromise = new Promise<'aborted'>((resolve) => {
      if (signal.aborted) resolve('aborted');
      signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    });
    const settled = await Promise.race([
      call.catch(() => 'aborted' as const),
      timeout,
      abortedPromise,
    ]);
    if (settled === 'timeout') {
      return {
        error: {
          ok: false,
          errorCode: 'ASSISTANT_TOOL_TIMEOUT',
          message: 'Действие не ответило вовремя',
        },
      };
    }
    if (settled === 'aborted' || signal.aborted) return { error: aborted() };
    return { status: settled.statusCode, body: settled.body };
  }

  private errorOf(status: number, data: unknown): ToolExecution {
    const body = asRecord(data);
    const code = str(body?.code) ?? `HTTP_${status}`;
    const human = errorMessages[code as keyof typeof errorMessages];
    const fallback = str(body?.message) ?? 'запрос отклонён';
    return {
      ok: false,
      errorCode: code,
      message:
        status === 403
          ? 'Недостаточно прав для этого действия (портал отклонил запрос)'
          : (human ?? `Ошибка API портала: ${fallback}`),
    };
  }
}

/** Общая проверка аргументов: карточка и вызов валидируются одинаково. */
export function parseToolInput(
  tool: AssistantToolDefinition,
  rawInput: unknown,
): { ok: true; input: Record<string, unknown> } | { ok: false; error: ToolFailure } {
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || 'аргументы'}: ${issue.message}`)
      .join('; ');
    return {
      ok: false,
      error: {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        message: `Аргументы инструмента неверны (${issues})`,
      },
    };
  }
  return { ok: true, input: parsed.data as Record<string, unknown> };
}

function aborted(): ToolExecution {
  return { ok: false, errorCode: 'ASSISTANT_TOOL_ABORTED', message: 'Прогон остановлен' };
}

/** Сигнал для действий вне прогона: карточку можно исполнить в любой момент. */
function neverAborted(): AbortSignal {
  return new AbortController().signal;
}

/** Путь + query → URL внутри API (`/api/v1…`): глобальный префикс приложения. */
function toUrl(request: ToolRequest): string {
  const query = request.query
    ? Object.entries(request.query)
        .filter(([, value]) => value !== undefined && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&')
    : '';
  return `/api/v1${request.path}${query ? `?${query}` : ''}`;
}

function parseBody(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
